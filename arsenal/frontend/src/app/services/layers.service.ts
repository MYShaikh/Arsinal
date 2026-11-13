import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { NuclearPlant, PlaceInfo } from '../models';
import { BadgeKind, MapMarker, MarkerFactory, badgeContent } from './html-marker';
import { ToastService } from './toast.service';

export type LayerId = BadgeKind;
type NearbyId = Exclude<LayerId, 'nuclear'>;

export const LAYERS: { id: LayerId; label: string; color: string }[] = [
  { id: 'nuclear', label: 'Nuclear power plants', color: '#ffd400' },
  { id: 'hospital', label: 'Hospitals', color: '#d93025' },
  { id: 'pharmacy', label: 'Pharmacies', color: '#188038' },
  { id: 'gun', label: 'Gun stores', color: '#3c4043' },
];

/** Below this zoom a view covers too much ground for a 20 result search to be useful. */
export const MIN_NEARBY_ZOOM = 12;
const MAX_MARKERS_PER_LAYER = 300;
const SEARCH_FIELDS = ['id', 'displayName', 'formattedAddress', 'location'];

export interface LayerContext {
  map: google.maps.Map;
  places: google.maps.PlacesLibrary;
  createMarker: MarkerFactory;
  select(place: PlaceInfo): void;
  selectById(placeId: string): void;
}

/**
 * The only places drawn on the map besides the user's own pins.
 * Nuclear plants come from Django (all of them, always). Hospitals, pharmacies and gun stores are searched for
 * in the visible area through the Places API (New) as the user pans and zooms.
 */
@Injectable({ providedIn: 'root' })
export class LayersService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly layers = LAYERS;
  readonly enabled = signal<Record<LayerId, boolean>>({ nuclear: true, hospital: true, pharmacy: true, gun: true });
  /** True while the map is zoomed out too far to search for hospitals, pharmacies and gun stores. */
  readonly zoomedOut = signal(false);
  readonly nuclearCount = signal(0);

  private ctx?: LayerContext;
  private nuclear: MapMarker[] = [];
  private readonly nearby: Record<NearbyId, Map<string, MapMarker>> = {
    hospital: new Map(),
    pharmacy: new Map(),
    gun: new Map(),
  };
  private readonly searched = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;
  private warned = false;

  async attach(ctx: LayerContext) {
    this.ctx = ctx;
    ctx.map.addListener('idle', () => this.scheduleRefresh());
    await this.loadNuclear();
    this.scheduleRefresh();
  }

  toggle(id: LayerId) {
    this.enabled.update((e) => ({ ...e, [id]: !e[id] }));
    const map = this.enabled()[id] ? (this.ctx?.map ?? null) : null;
    const markers = id === 'nuclear' ? this.nuclear : [...this.nearby[id].values()];
    markers.forEach((m) => m.setMap(map));
    if (map && id !== 'nuclear') this.scheduleRefresh();
  }

  // ---- Nuclear power plants (Django) --------------------------------------------------------

  private async loadNuclear() {
    const ctx = this.ctx!;
    let plants: NuclearPlant[];
    try {
      plants = await firstValueFrom(this.http.get<NuclearPlant[]>(`${API_BASE}/nuclear/`));
    } catch {
      this.toast.show('Could not load nuclear power plants from the Arsenal API.');
      return;
    }
    this.nuclearCount.set(plants.length);
    this.nuclear = plants.map((plant) => {
      const capacity = plant.capacity_mw ? `${plant.capacity_mw.toLocaleString()} MW` : '';
      const marker = ctx.createMarker({
        position: { lat: plant.lat, lng: plant.lng },
        content: badgeContent('nuclear'),
        title: [plant.name, capacity].filter(Boolean).join(' · '),
        zIndex: 5,
        onClick: () =>
          ctx.select({
            name: plant.name,
            address: '',
            description: ['Nuclear power plant', plant.operator && `Operated by ${plant.operator}`, capacity && `${capacity} capacity`]
              .filter(Boolean)
              .join(' · '),
            lat: plant.lat,
            lng: plant.lng,
          }),
      });
      if (this.enabled().nuclear) marker.setMap(ctx.map);
      return marker;
    });
  }

  // ---- Hospitals, pharmacies, gun stores (Places API) ---------------------------------------

  private scheduleRefresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 500);
  }

  private async refresh() {
    const map = this.ctx?.map;
    const bounds = map?.getBounds();
    const zoom = map?.getZoom() ?? 0;
    this.zoomedOut.set(zoom < MIN_NEARBY_ZOOM);
    if (!map || !bounds || zoom < MIN_NEARBY_ZOOM) return;

    const wanted = (['hospital', 'pharmacy', 'gun'] as const).filter((id) => this.enabled()[id]);
    await Promise.all(wanted.map((id) => this.search(id, bounds, zoom)));
  }

  private async search(id: NearbyId, bounds: google.maps.LatLngBounds, zoom: number) {
    // Searching the same patch of map twice would only cost money, so remember which patches were done.
    const step = 180 / 2 ** zoom;
    const centre = bounds.getCenter();
    const key = `${id}:${zoom}:${Math.round(centre.lat() / step)}:${Math.round(centre.lng() / step)}`;
    if (this.searched.has(key)) return;
    this.searched.add(key);

    try {
      for (const place of await this.fetchPlaces(id, bounds)) this.addMarker(id, place);
    } catch {
      this.searched.delete(key);
      if (!this.warned) {
        this.warned = true;
        this.toast.show('Could not load nearby places. Check that Places API (New) is enabled for your key.', 6000);
      }
    }
  }

  private async fetchPlaces(id: NearbyId, bounds: google.maps.LatLngBounds) {
    const { Place } = this.ctx!.places;
    if (id === 'gun') {
      // Google has no gun store place type, so this is a text search limited to the visible area.
      const { places } = await Place.searchByText({
        textQuery: 'gun store',
        fields: SEARCH_FIELDS,
        locationRestriction: bounds,
        maxResultCount: 20,
      });
      return places;
    }
    const centre = bounds.getCenter();
    const radius = Math.min(50000, distanceMetres(centre.toJSON(), bounds.getNorthEast().toJSON()));
    const { places } = await Place.searchNearby({
      fields: SEARCH_FIELDS,
      locationRestriction: { center: centre.toJSON(), radius },
      includedPrimaryTypes: [id],
      maxResultCount: 20,
    });
    return places;
  }

  private addMarker(id: NearbyId, place: google.maps.places.Place) {
    const ctx = this.ctx!;
    const markers = this.nearby[id];
    if (!place.location || markers.has(place.id)) return;

    if (markers.size >= MAX_MARKERS_PER_LAYER) {
      // Drop the oldest and forget searched patches, so panning back reloads them.
      const [oldestId, oldest] = markers.entries().next().value as [string, MapMarker];
      oldest.setMap(null);
      markers.delete(oldestId);
      this.searched.clear();
    }
    const marker = ctx.createMarker({
      position: place.location.toJSON(),
      content: badgeContent(id),
      title: place.displayName ?? '',
      zIndex: 3,
      onClick: () => ctx.selectById(place.id),
    });
    marker.setMap(ctx.map);
    markers.set(place.id, marker);
  }
}

function distanceMetres(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
