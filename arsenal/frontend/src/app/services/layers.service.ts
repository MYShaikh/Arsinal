import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { NuclearPlant, PlaceInfo } from '../models';
import { MapMarker, MarkerFactory, redDotContent } from './html-marker';
import { ToastService } from './toast.service';

/** Radius of the red zone drawn around each plant. */
export const PLANT_ZONE_METRES = 100;
const RED = '#e53935';

export interface LayerContext {
  map: google.maps.Map;
  createMarker: MarkerFactory;
  select(place: PlaceInfo): void;
}

/**
 * The only places Arsenal draws besides the user's own pins: every operating nuclear power plant, served by Django,
 * as a red dot with a translucent red circle around it.
 */
@Injectable({ providedIn: 'root' })
export class LayersService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly plantsVisible = signal(true);
  readonly plantCount = signal(0);

  private map?: google.maps.Map;
  private dots: MapMarker[] = [];
  private zones: google.maps.Circle[] = [];

  async attach(ctx: LayerContext) {
    this.map = ctx.map;
    let plants: NuclearPlant[];
    try {
      plants = await firstValueFrom(this.http.get<NuclearPlant[]>(`${API_BASE}/nuclear/`));
    } catch {
      this.toast.show('Could not load nuclear power plants from the Arsenal API.');
      return;
    }
    this.plantCount.set(plants.length);

    for (const plant of plants) {
      const position = { lat: plant.lat, lng: plant.lng };
      const capacity = plant.capacity_mw ? `${plant.capacity_mw.toLocaleString()} MW` : '';
      this.dots.push(
        ctx.createMarker({
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
        }),
      );
      this.zones.push(
        new google.maps.Circle({
          center: position,
          radius: PLANT_ZONE_METRES,
          fillColor: RED,
          fillOpacity: 0.3,
          strokeColor: RED,
          strokeOpacity: 0.8,
          strokeWeight: 1,
          clickable: false,
          zIndex: 1,
        }),
      );
    }
    this.render();
  }

  toggle() {
    this.plantsVisible.update((v) => !v);
    this.render();
  }

  private render() {
    const map = this.plantsVisible() ? (this.map ?? null) : null;
    this.dots.forEach((dot) => dot.setMap(map));
    this.zones.forEach((zone) => zone.setMap(map));
  }
}
