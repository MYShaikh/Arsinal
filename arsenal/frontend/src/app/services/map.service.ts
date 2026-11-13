import { HttpClient } from '@angular/common/http';
import { Injectable, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { CATEGORIES, MapType, PlaceInfo, RouteInfo, SavedPlace, Suggestion, TravelMode } from '../models';
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

/** Owns the Google Maps instance and everything drawn on it. */
@Injectable({ providedIn: 'root' })
export class MapService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(PlacesStore);
  private readonly toast = inject(ToastService);

  readonly status = signal<MapStatus>('loading');
  readonly errorDetail = signal('');
  readonly selected = signal<PlaceInfo | null>(null);
  readonly route = signal<RouteInfo | null>(null);
  readonly mapType = signal<MapType>('roadmap');
  readonly traffic = signal(false);
  readonly locating = signal(false);
  readonly userLocation = signal<google.maps.LatLngLiteral | null>(null);

  private map?: google.maps.Map;
  private mapsLib?: google.maps.MapsLibrary;
  private placesLib?: google.maps.PlacesLibrary;
  private routesLib?: google.maps.RoutesLibrary;
  private markerLib?: google.maps.MarkerLibrary;
  private geocodingLib?: google.maps.GeocodingLibrary;

  private selectedMarker?: google.maps.marker.AdvancedMarkerElement;
  private userMarker?: google.maps.marker.AdvancedMarkerElement;
  private savedMarkers: google.maps.marker.AdvancedMarkerElement[] = [];
  private trafficLayer?: google.maps.TrafficLayer;
  private routeLines: google.maps.Polyline[] = [];
  private sessionToken?: google.maps.places.AutocompleteSessionToken;
  private started = false;

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
      [this.mapsLib, this.placesLib, this.routesLib, this.markerLib, this.geocodingLib] = (await Promise.all([
        google.maps.importLibrary('maps'),
        google.maps.importLibrary('places'),
        google.maps.importLibrary('routes'),
        google.maps.importLibrary('marker'),
        google.maps.importLibrary('geocoding'),
      ])) as [
        google.maps.MapsLibrary,
        google.maps.PlacesLibrary,
        google.maps.RoutesLibrary,
        google.maps.MarkerLibrary,
        google.maps.GeocodingLibrary,
      ];
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'Google Maps failed to load.');
      return;
    }

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    this.map = new this.mapsLib.Map(container, {
      center: { lat: 30, lng: 0 },
      zoom: 3,
      // A mapId is required for advanced markers. DEMO_MAP_ID is Google's placeholder for development.
      mapId: 'DEMO_MAP_ID',
      colorScheme: dark ? google.maps.ColorScheme.DARK : google.maps.ColorScheme.LIGHT,
      disableDefaultUI: true,
      gestureHandling: 'greedy',
      clickableIcons: true,
    });
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
    if (this.selectedMarker) this.selectedMarker.map = null;
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

  /** Centres the map on the user. Returns the position, or null if it was denied. */
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
    if (!this.map || !this.markerLib) return;
    const position = { lat: place.lat, lng: place.lng };
    if (!this.selectedMarker) {
      this.selectedMarker = new this.markerLib.AdvancedMarkerElement({ map: this.map, position, zIndex: 10 });
    }
    this.selectedMarker.position = position;
    this.selectedMarker.title = place.name;
    this.selectedMarker.map = this.map;
  }

  private drawSavedMarkers(saved: SavedPlace[]) {
    if (!this.map || !this.markerLib) return;
    this.savedMarkers.forEach((m) => (m.map = null));
    this.savedMarkers = saved.map((s) => {
      const color = CATEGORIES.find((c) => c.value === s.category)?.color ?? '#d93025';
      const pin = new this.markerLib!.PinElement({
        background: color,
        borderColor: '#ffffff',
        glyphColor: '#ffffff',
        scale: 0.8,
      });
      const marker = new this.markerLib!.AdvancedMarkerElement({
        map: this.map,
        position: { lat: s.lat, lng: s.lng },
        title: s.name,
        content: pin,
      });
      marker.addListener('click', () =>
        this.show({ name: s.name, address: s.address, lat: s.lat, lng: s.lng, placeId: s.google_place_id || undefined }),
      );
      return marker;
    });
  }

  private drawUserMarker(position: google.maps.LatLngLiteral) {
    if (!this.map || !this.markerLib) return;
    if (!this.userMarker) {
      const dot = document.createElement('div');
      dot.style.cssText =
        'width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 2px rgba(26,115,232,.35),0 1px 4px rgba(0,0,0,.4)';
      this.userMarker = new this.markerLib.AdvancedMarkerElement({ map: this.map, position, content: dot, title: 'You are here' });
    }
    this.userMarker.position = position;
  }

  private async locateIfAlreadyAllowed() {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') await this.locate();
    } catch {
      // The Permissions API is not available everywhere; the locate button still works.
    }
  }

  private loadScript(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      w['__arsenalMapsReady'] = () => resolve();
      w['gm_authFailure'] = () =>
        this.fail('Google rejected the API key. Check the key, its allowed websites and that billing is enabled.');
      const script = document.createElement('script');
      script.src =
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
        `&v=weekly&loading=async&callback=__arsenalMapsReady`;
      script.async = true;
      script.onerror = () => reject(new Error('Could not reach Google Maps. Check your connection.'));
      document.head.appendChild(script);
    });
  }

  private fail(detail: string) {
    this.errorDetail.set(detail);
    this.status.set('error');
  }
}
