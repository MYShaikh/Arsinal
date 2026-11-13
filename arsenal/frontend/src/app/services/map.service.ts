import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { CATEGORIES, MapType, PlaceInfo, RouteInfo, SavedPlace, Suggestion, TravelMode } from '../models';
import { MapMarker, MarkerFactory, createMarkerFactory, pinContent, userDotContent } from './html-marker';
import { LayersService } from './layers.service';
import { DARK_THEME, HIDE_DEFAULT_PLACES } from './map-style';
import { PlacesStore } from './places.store';
import { ToastService } from './toast.service';

export type MapStatus = 'loading' | 'ready' | 'no-key' | 'api-down' | 'error';

const PLACE_FIELDS = [
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'websiteURI',
  'nationalPhoneNumber',
  'photos',
  'regularOpeningHours',
];

const GOOGLE_ERRORS: Record<string, string> = {
  InvalidKeyMapError: 'The API key is not valid. Maps keys start with "AIza"; create one under APIs & Services → Credentials.',
  ApiNotActivatedMapError: 'Maps JavaScript API is not enabled for this key. Enable it in APIs & Services → Library.',
  BillingNotEnabledMapError: 'Billing is not enabled on the key\'s Google Cloud project. Link a billing account.',
  RefererNotAllowedMapError: 'This website is not allowed for the key. Add http://localhost:4200/* under its website restrictions.',
  MissingKeyMapError: 'No API key was sent to Google.',
  ExpiredKeyMapError: 'The API key has expired.',
  RequestDeniedMapError: 'Google denied the request. Check the key\'s API restrictions include Maps JavaScript API.',
};

function describeGoogleError(code: string): string {
  const hint = GOOGLE_ERRORS[code];
  if (hint) return `${hint} (${code})`;
  return code
    ? `Google rejected the API key (${code}).`
    : 'Google rejected the API key. Check the key, its allowed websites and that billing is enabled.';
}

/** Owns the Google Maps instance and everything drawn on it. */
@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PlacesStore);
  private readonly toast = inject(ToastService);
  private readonly layers = inject(LayersService);

  readonly status = signal<MapStatus>('loading');
  readonly errorDetail = signal('');
  readonly selected = signal<PlaceInfo | null>(null);
  readonly route = signal<RouteInfo | null>(null);
  readonly mapType = signal<MapType>('roadmap');
  readonly traffic = signal(false);
  readonly locating = signal(false);
  /** Watching the user's position, so the blue dot moves as they do. */
  readonly tracking = signal(false);
  /** The map re-centres on every position update. Dragging the map turns this off. */
  readonly following = signal(false);
  readonly userLocation = signal<google.maps.LatLngLiteral | null>(null);

  private map?: google.maps.Map;
  private mapsLib?: google.maps.MapsLibrary;
  private placesLib?: google.maps.PlacesLibrary;
  private routesLib?: google.maps.RoutesLibrary;
  private geocodingLib?: google.maps.GeocodingLibrary;

  private createMarker?: MarkerFactory;
  private selectedMarker?: MapMarker;
  private userMarker?: MapMarker;
  private accuracyCircle?: google.maps.Circle;
  private watchId?: number;
  private savedMarkers: MapMarker[] = [];
  private trafficLayer?: google.maps.TrafficLayer;
  private routeLines: google.maps.Polyline[] = [];
  private sessionToken?: google.maps.places.AutocompleteSessionToken;
  private started = false;
  private googleErrorCode = '';

  constructor() {
    effect(() => {
      const saved = this.store.saved();
      if (this.status() === 'ready') this.drawSavedMarkers(saved);
    });
  }

  /** Fetches the Maps key from Django, loads the Maps JS API and creates the map. */
  async init(container: HTMLElement) {
    if (this.started) return;
    this.started = true;

    let key: string;
    try {
      key = (await firstValueFrom(this.http.get<{ googleMapsApiKey: string }>(`${API_BASE}/config/`))).googleMapsApiKey;
    } catch {
      this.status.set('api-down');
      return;
    }
    if (!key) {
      this.status.set('no-key');
      return;
    }

    try {
      await this.loadScript(key);
      [this.mapsLib, this.placesLib, this.routesLib, this.geocodingLib] = (await Promise.all([
        google.maps.importLibrary('maps'),
        google.maps.importLibrary('places'),
        google.maps.importLibrary('routes'),
        google.maps.importLibrary('geocoding'),
      ])) as [
        google.maps.MapsLibrary,
        google.maps.PlacesLibrary,
        google.maps.RoutesLibrary,
        google.maps.GeocodingLibrary,
      ];
      this.createMarker = createMarkerFactory();
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Google Maps failed to load.');
      return;
    }

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.map = new this.mapsLib.Map(container, {
      center: { lat: 30, lng: 0 },
      zoom: 3,
      // No mapId: JSON styles only apply to maps without one. See map-style.ts.
      styles: dark ? [...DARK_THEME, ...HIDE_DEFAULT_PLACES] : HIDE_DEFAULT_PLACES,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: false,
    });
    this.map.addListener('dragstart', () => this.following.set(false));
    this.map.addListener('click', (e: google.maps.MapMouseEvent | google.maps.IconMouseEvent) => {
      const placeId = (e as google.maps.IconMouseEvent).placeId;
      if (placeId) {
        e.stop?.();
        void this.selectPlaceId(placeId);
      } else if (e.latLng) {
        void this.selectPoint(e.latLng.lat(), e.latLng.lng());
      }
    });

    this.status.set('ready');
    this.drawSavedMarkers(this.store.saved());
    void this.layers.attach({
      map: this.map,
      places: this.placesLib,
      createMarker: this.createMarker,
      select: (place) => this.show(place),
      selectById: (placeId) => void this.selectPlaceId(placeId),
    });
    void this.locateIfAlreadyAllowed();
  }

  // ---- Search -------------------------------------------------------------------------------

  async suggest(input: string): Promise<Suggestion[]> {
    if (!input.trim() || !this.placesLib) return [];
    this.sessionToken ??= new this.placesLib.AutocompleteSessionToken();
    try {
      const { suggestions } = await this.placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input,
        sessionToken: this.sessionToken,
        locationBias: this.map?.getBounds() ?? undefined,
      });
      return suggestions.flatMap((s) =>
        s.placePrediction
          ? [
              {
                text: s.placePrediction.text.text,
                main: s.placePrediction.mainText?.text ?? s.placePrediction.text.text,
                secondary: s.placePrediction.secondaryText?.text ?? '',
                prediction: s.placePrediction,
              },
            ]
          : [],
      );
    } catch {
      this.toast.show('Search is unavailable. Check that the Places API (New) is enabled for your key.');
      return [];
    }
  }

  /** Turns an autocomplete suggestion into a full place. Ends the autocomplete billing session. */
  async resolve(suggestion: Suggestion): Promise<PlaceInfo> {
    const place = suggestion.prediction.toPlace();
    this.sessionToken = undefined;
    await place.fetchFields({ fields: PLACE_FIELDS });
    return this.toPlaceInfo(place);
  }

  // ---- Selection ----------------------------------------------------------------------------

  /** Shows a place on the map and in the side panel. */
  show(place: PlaceInfo) {
    this.selected.set(place);
    this.placeSelectedMarker(place);
    this.focus(place.lat, place.lng, 16);
  }

  clearSelection() {
    this.selected.set(null);
    this.selectedMarker?.setMap(null);
  }

  async selectPlaceId(placeId: string) {
    if (!this.placesLib) return;
    try {
      const place = new this.placesLib.Place({ id: placeId });
      await place.fetchFields({ fields: PLACE_FIELDS });
      this.show(await this.toPlaceInfo(place));
    } catch {
      this.toast.show('Could not load details for that place.');
    }
  }

  async selectPoint(lat: number, lng: number) {
    const dropped: PlaceInfo = { name: 'Dropped pin', address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`, lat, lng };
    this.selected.set(dropped);
    this.placeSelectedMarker(dropped);
    try {
      const { results } = await new this.geocodingLib!.Geocoder().geocode({ location: { lat, lng } });
      const current = this.selected();
      if (results[0] && current === dropped) this.selected.set({ ...dropped, address: results[0].formatted_address });
    } catch {
      // Without the Geocoding API the pin keeps its coordinates as the address.
    }
  }

  focus(lat: number, lng: number, zoom?: number) {
    if (!this.map) return;
    this.map.panTo({ lat, lng });
    if (zoom && (this.map.getZoom() ?? 0) < zoom) this.map.setZoom(zoom);
  }

  // ---- Controls -----------------------------------------------------------------------------

  zoomBy(delta: number) {
    if (this.map) this.map.setZoom((this.map.getZoom() ?? 3) + delta);
  }

  setMapType(type: MapType) {
    this.mapType.set(type);
    this.map?.setMapTypeId(type);
  }

  toggleTraffic() {
    if (!this.map || !this.mapsLib) return;
    this.trafficLayer ??= new this.mapsLib.TrafficLayer();
    const on = !this.traffic();
    this.trafficLayer.setMap(on ? this.map : null);
    this.traffic.set(on);
  }

  /**
   * Location button behaviour. First press starts live tracking and follows the user.
   * If the user has panned away, a press re-centres on them; a press while following stops tracking.
   */
  locateMe() {
    if (!this.tracking()) {
      this.startTracking();
    } else if (!this.following()) {
      const here = this.userLocation();
      this.following.set(true);
      if (here) this.focus(here.lat, here.lng, 16);
    } else {
      this.stopTracking();
    }
  }

  startTracking() {
    if (this.tracking() || this.locating()) return;
    if (!navigator.geolocation) {
      this.toast.show('This browser does not support location.');
      return;
    }
    this.locating.set(true);
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!this.tracking()) {
          this.tracking.set(true);
          this.following.set(true);
        }
        this.locating.set(false);
        this.userLocation.set(here);
        this.drawUserMarker(here, pos.coords.accuracy);
        if (this.following()) this.focus(here.lat, here.lng, 16);
      },
      (err) => {
        this.stopTracking();
        this.toast.show(
          err.code === err.PERMISSION_DENIED
            ? 'Location is blocked. Allow it in the browser\'s site settings and try again.'
            : 'Could not get your location right now.',
        );
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  stopTracking() {
    if (this.watchId !== undefined) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = undefined;
    this.tracking.set(false);
    this.following.set(false);
    this.locating.set(false);
    this.userMarker?.setMap(null);
    this.userMarker = undefined;
    this.accuracyCircle?.setMap(null);
    this.accuracyCircle = undefined;
  }

  /** One-off position lookup, used by directions. Centres the map on the user. */
  async locate(): Promise<google.maps.LatLngLiteral | null> {
    if (!navigator.geolocation) {
      this.toast.show('This browser does not support location.');
      return null;
    }
    this.locating.set(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }),
      );
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      this.userLocation.set(here);
      this.drawUserMarker(here);
      this.focus(here.lat, here.lng, 15);
      return here;
    } catch {
      this.toast.show('Could not get your location. Check the browser permission.');
      return null;
    } finally {
      this.locating.set(false);
    }
  }

  // ---- Directions ---------------------------------------------------------------------------

  async showRoute(origin: google.maps.LatLngLiteral, destination: google.maps.LatLngLiteral, mode: TravelMode) {
    this.clearRoute();
    const { Route } = this.routesLib!;
    const { routes } = await Route.computeRoutes({
      origin,
      destination,
      travelMode: mode,
      fields: ['path', 'viewport', 'legs', 'localizedValues', 'distanceMeters', 'durationMillis'],
    });
    const best = routes?.[0];
    if (!best) throw new Error('No route found');

    this.clearRoute(); // a slower, older request may have drawn while this one was in flight
    this.routeLines = best.createPolylines({
      polylineOptions: { strokeColor: '#1a73e8', strokeWeight: 6, strokeOpacity: 0.9 },
    });
    this.routeLines.forEach((line) => line.setMap(this.map ?? null));
    if (best.viewport) this.map?.fitBounds(best.viewport, { top: 60, bottom: 60, left: 60, right: 60 });

    const info: RouteInfo = {
      distance: best.localizedValues?.distance ?? `${((best.distanceMeters ?? 0) / 1000).toFixed(1)} km`,
      duration: best.localizedValues?.duration ?? `${Math.round((best.durationMillis ?? 0) / 60000)} min`,
      steps: (best.legs ?? []).flatMap((leg) =>
        leg.steps.map((step) => ({
          instructions: step.instructions ?? 'Continue',
          distance: step.localizedValues?.distance ?? '',
        })),
      ),
    };
    this.route.set(info);
    return info;
  }

  clearRoute() {
    this.routeLines.forEach((line) => line.setMap(null));
    this.routeLines = [];
    this.route.set(null);
  }

  // ---- Internals ----------------------------------------------------------------------------

  private async toPlaceInfo(place: google.maps.places.Place): Promise<PlaceInfo> {
    let openNow: boolean | undefined;
    try {
      openNow = (await place.isOpen()) ?? undefined;
    } catch {
      openNow = undefined;
    }
    return {
      name: place.displayName ?? 'Unnamed place',
      address: place.formattedAddress ?? '',
      lat: place.location?.lat() ?? 0,
      lng: place.location?.lng() ?? 0,
      placeId: place.id,
      rating: place.rating ?? undefined,
      ratingCount: place.userRatingCount ?? undefined,
      website: place.websiteURI ?? undefined,
      phone: place.nationalPhoneNumber ?? undefined,
      photoUrl: place.photos?.[0]?.getURI({ maxWidth: 640 }),
      openNow,
      hours: place.regularOpeningHours?.weekdayDescriptions,
    };
  }

  private placeSelectedMarker(place: PlaceInfo) {
    if (!this.map || !this.createMarker) return;
    const position = { lat: place.lat, lng: place.lng };
    this.selectedMarker?.setMap(null);
    this.selectedMarker = this.createMarker({
      position,
      content: pinContent('#ea4335'),
      anchor: 'bottom',
      title: place.name,
      zIndex: 10,
    });
    this.selectedMarker.setMap(this.map);
  }

  private drawSavedMarkers(saved: SavedPlace[]) {
    if (!this.map || !this.createMarker) return;
    this.savedMarkers.forEach((m) => m.setMap(null));
    this.savedMarkers = saved.map((s) => {
      const color = CATEGORIES.find((c) => c.value === s.category)?.color ?? '#d93025';
      const marker = this.createMarker!({
        position: { lat: s.lat, lng: s.lng },
        content: pinContent(color),
        anchor: 'bottom',
        title: s.name,
        zIndex: 8,
        onClick: () =>
          this.show({ name: s.name, address: s.address, lat: s.lat, lng: s.lng, placeId: s.google_place_id || undefined }),
      });
      marker.setMap(this.map ?? null);
      return marker;
    });
  }

  private drawUserMarker(position: google.maps.LatLngLiteral, accuracy?: number) {
    if (!this.map || !this.createMarker || !this.mapsLib) return;
    if (accuracy !== undefined) {
      if (!this.accuracyCircle) {
        this.accuracyCircle = new this.mapsLib.Circle({
          map: this.map,
          fillColor: '#1a73e8',
          fillOpacity: 0.12,
          strokeWeight: 0,
          clickable: false,
        });
      }
      this.accuracyCircle.setCenter(position);
      this.accuracyCircle.setRadius(accuracy);
    }
    if (!this.userMarker) {
      this.userMarker = this.createMarker({ position, content: userDotContent(), title: 'You are here', zIndex: 9 });
      this.userMarker.setMap(this.map);
    }
    this.userMarker.setPosition(position);
  }

  private async locateIfAlreadyAllowed() {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') this.startTracking();
    } catch {
      // The Permissions API is not available everywhere; the locate button still works.
    }
  }

  private loadScript(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      w['__arsenalMapsReady'] = () => resolve();
      w['gm_authFailure'] = () => this.fail(describeGoogleError(this.googleErrorCode));
      this.captureGoogleErrorCode();
      const script = document.createElement('script');
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
        `&v=weekly&loading=async&callback=__arsenalMapsReady`;
      script.async = true;
      script.onerror = () => reject(new Error('Could not reach Google Maps. Check your connection.'));
      document.head.appendChild(script);
    });
  }

  /** Google reports why a key failed only through console.error, so listen for it to show a useful message. */
  private captureGoogleErrorCode() {
    const original = console.error;
    console.error = (...args: unknown[]) => {
      const code = /Google Maps JavaScript API error: (\w+)/.exec(String(args[0]))?.[1];
      if (code) {
        this.googleErrorCode = code;
        if (this.status() === 'error') this.errorDetail.set(describeGoogleError(code));
      }
      original.apply(console, args);
    };
  }

  private fail(detail: string) {
    this.errorDetail.set(detail);
    this.status.set('error');
  }
}
