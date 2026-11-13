import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { NuclearPlant, PlaceInfo, Poi, PoiCategory } from '../models';
import { MapMarker, MarkerFactory, badgeContent, redDotContent } from './html-marker';
import { ToastService } from './toast.service';

export type LayerId = 'nuclear' | PoiCategory;

export const LAYERS: { id: LayerId; label: string; singular: string; color: string }[] = [
  { id: 'nuclear', label: 'Nuclear power plants', singular: 'Nuclear power plant', color: '#e53935' },
  { id: 'hospital', label: 'Hospitals', singular: 'Hospital', color: '#d93025' },
  { id: 'pharmacy', label: 'Pharmacies', singular: 'Pharmacy', color: '#188038' },
  { id: 'grocery', label: 'Grocery stores', singular: 'Grocery store', color: '#ef6c00' },
  { id: 'ammo', label: 'Ammunition shops', singular: 'Ammunition shop', color: '#3c4043' },
];

/** Radius of the translucent zone drawn around each nuclear plant. */
export const PLANT_ZONE_METRES = 100;
const PLANT_RED = '#e53935';

/** Hospitals and the rest are loaded per map tile, so a view is only searched when zoomed in this far. */
export const MIN_POI_ZOOM = 12;
const TILE_ZOOM = 12; // must match the Django API
const MAX_TILES_PER_VIEW = 24;
const MAX_PARALLEL_TILES = 2;
const RETRY_FAILED_TILE_MS = 30000;

type PoiId = PoiCategory;

export interface LayerContext {
  map: google.maps.Map;
  createMarker: MarkerFactory;
  select(place: PlaceInfo): void;
}

/**
 * Everything drawn on the map besides the user's own pins and the water direction.
 * Nuclear plants (all of them) come from Django once. Hospitals, pharmacies, grocery stores and ammunition shops
 * come from Django per map tile as the user pans and zooms, so every mapped one is shown, not just the first few.
 */
@Injectable({ providedIn: 'root' })
export class LayersService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly layers = LAYERS;
  readonly enabled = signal<Record<LayerId, boolean>>({
    nuclear: true,
    hospital: true,
    pharmacy: true,
    grocery: true,
    ammo: true,
  });
  readonly counts = signal<Record<LayerId, number>>({ nuclear: 0, hospital: 0, pharmacy: 0, grocery: 0, ammo: 0 });
  /** True while the map is zoomed out too far to load hospitals, pharmacies, grocery stores and ammunition shops. */
  readonly zoomedOut = signal(false);
  readonly loadingTiles = signal(0);

  private ctx?: LayerContext;
  private dots: MapMarker[] = [];
  private zones: google.maps.Circle[] = [];
  private readonly poiMarkers: Record<PoiId, Map<string, MapMarker>> = {
    hospital: new Map(),
    pharmacy: new Map(),
    grocery: new Map(),
    ammo: new Map(),
  };
  private readonly loaded = new Set<string>();
  private readonly failedAt = new Map<string, number>();
  private readonly inFlight = new Set<string>();
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
    if (id === 'nuclear') {
      this.dots.forEach((dot) => dot.setMap(map));
      this.zones.forEach((zone) => zone.setMap(map));
    } else {
      this.poiMarkers[id].forEach((marker) => marker.setMap(map));
      if (map) this.scheduleRefresh();
    }
  }

  // ---- Nuclear power plants -----------------------------------------------------------------

  private async loadNuclear() {
    const ctx = this.ctx!;
    let plants: NuclearPlant[];
    try {
      plants = await firstValueFrom(this.http.get<NuclearPlant[]>(`${API_BASE}/nuclear/`));
    } catch {
      this.toast.show('Could not load nuclear power plants from the Arsenal API.');
      return;
    }
    this.counts.update((c) => ({ ...c, nuclear: plants.length }));

    const map = this.enabled().nuclear ? ctx.map : null;
    for (const plant of plants) {
      const position = { lat: plant.lat, lng: plant.lng };
      const capacity = plant.capacity_mw ? `${plant.capacity_mw.toLocaleString()} MW` : '';
      const dot = ctx.createMarker({
        position,
        content: redDotContent(),
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
      dot.setMap(map);
      this.dots.push(dot);

      // Light fill and a thin edge, so the map stays readable underneath.
      this.zones.push(
        new google.maps.Circle({
          map,
          center: position,
          radius: PLANT_ZONE_METRES,
          fillColor: PLANT_RED,
          fillOpacity: 0.15,
          strokeColor: PLANT_RED,
          strokeOpacity: 0.55,
          strokeWeight: 1,
          clickable: false,
          zIndex: 1,
        }),
      );
    }
  }

  // ---- Hospitals, pharmacies, grocery stores, ammunition shops ------------------------------

  private scheduleRefresh() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 400);
  }

  private anyPoiEnabled(): boolean {
    const e = this.enabled();
    return e.hospital || e.pharmacy || e.grocery || e.ammo;
  }

  private async refresh() {
    const map = this.ctx?.map;
    const bounds = map?.getBounds();
    const zoom = map?.getZoom() ?? 0;
    this.zoomedOut.set(zoom < MIN_POI_ZOOM);
    if (!map || !bounds || zoom < MIN_POI_ZOOM || !this.anyPoiEnabled()) return;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    if (sw.lng() > ne.lng()) return; // view crosses the antimeridian

    const xMin = tileX(sw.lng());
    const xMax = tileX(ne.lng());
    const yMin = tileY(ne.lat());
    const yMax = tileY(sw.lat());
    if ((xMax - xMin + 1) * (yMax - yMin + 1) > MAX_TILES_PER_VIEW) {
      this.zoomedOut.set(true);
      return;
    }

    // Closest to the centre first, so what the user is looking at appears first.
    const centre = map.getCenter()!;
    const cx = tileX(centre.lng());
    const cy = tileY(centre.lat());
    const wanted: { key: string; x: number; y: number; distance: number }[] = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        const key = `${x}/${y}`;
        const failed = this.failedAt.get(key);
        if (this.loaded.has(key) || this.inFlight.has(key) || (failed && Date.now() - failed < RETRY_FAILED_TILE_MS)) continue;
        wanted.push({ key, x, y, distance: Math.hypot(x - cx, y - cy) });
      }
    }
    wanted.sort((a, b) => a.distance - b.distance);

    // A small worker pool keeps the public OpenStreetMap servers behind Django from being hammered.
    const queue = [...wanted];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await this.loadTile(next.key, next.x, next.y);
    };
    await Promise.all(Array.from({ length: MAX_PARALLEL_TILES }, worker));
  }

  private async loadTile(key: string, x: number, y: number) {
    this.inFlight.add(key);
    this.loadingTiles.update((n) => n + 1);
    try {
      const places = await firstValueFrom(this.http.get<Poi[]>(`${API_BASE}/poi/${x}/${y}/`));
      this.loaded.add(key);
      this.failedAt.delete(key);
      places.forEach((place) => this.addPoi(place));
    } catch {
      this.failedAt.set(key, Date.now());
      if (!this.warned) {
        this.warned = true;
        this.toast.show('OpenStreetMap data is busy, so some places are missing. Arsenal will retry as you move the map.', 6000);
      }
    } finally {
      this.inFlight.delete(key);
      this.loadingTiles.update((n) => n - 1);
    }
  }

  private addPoi(poi: Poi) {
    const ctx = this.ctx!;
    const markers = this.poiMarkers[poi.category];
    if (markers.has(poi.id)) return;
    const layer = LAYERS.find((l) => l.id === poi.category)!;
    const marker = ctx.createMarker({
      position: { lat: poi.lat, lng: poi.lng },
      content: badgeContent(poi.category),
      title: poi.name ? `${poi.name} (${layer.singular})` : layer.singular,
      zIndex: 3,
      onClick: () =>
        ctx.select({ name: poi.name || layer.singular, address: '', description: layer.singular, lat: poi.lat, lng: poi.lng }),
    });
    marker.setMap(this.enabled()[poi.category] ? ctx.map : null);
    markers.set(poi.id, marker);
    this.counts.update((c) => ({ ...c, [poi.category]: markers.size }));
  }
}

const TILES = 2 ** TILE_ZOOM;
const tileX = (lng: number) => Math.min(TILES - 1, Math.max(0, Math.floor(((lng + 180) / 360) * TILES)));
const tileY = (lat: number) =>
  Math.min(
    TILES - 1,
    Math.max(0, Math.floor(((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * TILES)),
  );
