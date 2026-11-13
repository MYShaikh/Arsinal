import { HttpClient } from '@angular/common/http';
import { Injectable, Signal, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { bearingDeg, distanceMetres } from '../geo';
import { WaterResult } from '../models';
import { MapMarker, MarkerFactory, waterDotContent } from './html-marker';

export interface WaterContext {
  map: google.maps.Map;
  createMarker: MarkerFactory;
  /** The user's live position, when location is on. */
  userLocation: Signal<google.maps.LatLngLiteral | null>;
  /** Where to measure from: the user if known, otherwise the centre of the map. */
  reference(): { lat: number; lng: number; source: 'you' | 'map' };
}

export type WaterStatus = 'idle' | 'loading' | 'found' | 'none' | 'error';

/** Re-ask Django only after moving this far, since the answer barely changes over short distances. */
const REQUERY_FROM_USER_M = 100;
const REQUERY_FROM_MAP_CENTRE_M = 500;

/** Always-on direction to the nearest flowing water (river, stream or canal). */
@Injectable({ providedIn: 'root' })
export class WaterService {
  private readonly http = inject(HttpClient);

  readonly enabled = signal(true);
  readonly status = signal<WaterStatus>('idle');
  readonly result = signal<WaterResult | null>(null);
  readonly source = signal<'you' | 'map'>('map');
  /** Where the distance and bearing are measured from, which moves with the user or the map centre. */
  readonly origin = signal<google.maps.LatLngLiteral | null>(null);

  private readonly ctx = signal<WaterContext | null>(null);
  private line?: google.maps.Polyline;
  private marker?: MapMarker;
  private timer?: ReturnType<typeof setTimeout>;
  private requestId = 0;
  private queriedFrom?: google.maps.LatLngLiteral;

  constructor() {
    // A moving user changes the direction without the map going idle.
    effect(() => {
      const ctx = this.ctx();
      if (ctx && ctx.userLocation()) this.schedule();
    });
  }

  attach(ctx: WaterContext) {
    this.ctx.set(ctx);
    ctx.map.addListener('idle', () => this.schedule());
    this.schedule();
  }

  toggle() {
    this.enabled.update((v) => !v);
    if (this.enabled()) {
      this.schedule();
    } else {
      this.clearDrawing();
    }
  }

  /** Zooms the map to show both the user (or map centre) and the water. */
  showBoth() {
    const ctx = this.ctx();
    const origin = this.origin();
    const water = this.result();
    if (!ctx || !origin || !water?.found) return;
    const bounds = new google.maps.LatLngBounds(origin);
    bounds.extend({ lat: water.lat!, lng: water.lng! });
    ctx.map.fitBounds(bounds, 80);
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 500);
  }

  private async refresh() {
    const ctx = this.ctx();
    if (!ctx || !this.enabled()) return;

    const reference = ctx.reference();
    const here = { lat: reference.lat, lng: reference.lng };
    this.source.set(reference.source);
    this.origin.set(here);

    const threshold = reference.source === 'you' ? REQUERY_FROM_USER_M : REQUERY_FROM_MAP_CENTRE_M;
    const current = this.result();
    if (current && this.queriedFrom && distanceMetres(here, this.queriedFrom) < threshold) {
      this.draw(here); // the answer is still good, but the line and bearing start from the new position
      return;
    }

    const id = ++this.requestId;
    this.status.set('loading');
    try {
      const result = await firstValueFrom(
        this.http.get<WaterResult>(`${API_BASE}/water/nearest/`, { params: { lat: here.lat, lng: here.lng } }),
      );
      if (id !== this.requestId) return;
      this.queriedFrom = here;
      this.result.set(result);
      this.status.set(result.found ? 'found' : 'none');
      this.draw(here);
    } catch {
      if (id !== this.requestId) return;
      this.status.set('error');
    }
  }

  /** Draws a dashed line to the water and keeps the readout's distance and bearing in step with the origin. */
  private draw(origin: google.maps.LatLngLiteral) {
    const ctx = this.ctx();
    const water = this.result();
    if (!ctx || !water?.found || !this.enabled()) {
      this.clearDrawing();
      return;
    }
    const target = { lat: water.lat!, lng: water.lng! };

    this.result.set({ ...water, distance_m: Math.round(distanceMetres(origin, target)), bearing_deg: Math.round(bearingDeg(origin, target)) });

    if (!this.line) {
      this.line = new google.maps.Polyline({
        map: ctx.map,
        strokeOpacity: 0,
        clickable: false,
        zIndex: 2,
        icons: [
          { icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, strokeColor: '#1e88e5', strokeWeight: 3, scale: 3 }, offset: '0', repeat: '14px' },
        ],
      });
    }
    this.line.setPath([origin, target]);

    if (!this.marker) {
      this.marker = ctx.createMarker({ position: target, content: waterDotContent(), zIndex: 4, onClick: () => this.showBoth() });
      this.marker.setMap(ctx.map);
    }
    this.marker.setPosition(target);
  }

  private clearDrawing() {
    this.line?.setMap(null);
    this.line = undefined;
    this.marker?.setMap(null);
    this.marker = undefined;
  }
}
