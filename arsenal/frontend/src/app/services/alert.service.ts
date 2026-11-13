import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { LatLng, distanceMetres } from '../geo';
import { NuclearPlant } from '../models';
import { LayersService } from './layers.service';
import { MapService } from './map.service';

/** The alert starts inside this distance of a plant... */
export const ALERT_ENTER_METRES = 100;
/** ...and ends beyond this one, so GPS jitter at the edge does not make it flicker. */
export const ALERT_EXIT_METRES = 120;

export interface PlantAlert {
  plant: NuclearPlant;
  distance: number;
}

/**
 * Warns whenever the user's position is within 100 m of a nuclear power plant.
 * Distances are to the plant's mapped centre point; the site itself is usually far larger than 100 m.
 */
@Injectable({ providedIn: 'root' })
export class AlertService {
  private readonly maps = inject(MapService);
  private readonly layers = inject(LayersService);

  /** The plant the user is currently near, if any. Stays set until they leave, even if dismissed. */
  readonly active = signal<PlantAlert | null>(null);
  /** The user closed the banner for the current visit. A new entry shows it again. */
  readonly dismissed = signal(false);

  constructor() {
    effect(() => {
      const here = this.maps.userLocation();
      const plants = this.layers.plants();
      untracked(() => this.evaluate(here, plants));
    });
  }

  dismiss() {
    this.dismissed.set(true);
  }

  private evaluate(here: LatLng | null, plants: NuclearPlant[]) {
    const previous = this.active();
    if (!here || plants.length === 0) {
      this.active.set(null);
      return;
    }

    let nearest = plants[0];
    let distance = Infinity;
    for (const plant of plants) {
      const d = distanceMetres(here, plant);
      if (d < distance) {
        nearest = plant;
        distance = d;
      }
    }

    const stillInside = previous?.plant.id === nearest.id && distance <= ALERT_EXIT_METRES;
    if (distance <= ALERT_ENTER_METRES || stillInside) {
      this.active.set({ plant: nearest, distance: Math.round(distance) });
      if (previous?.plant.id !== nearest.id) {
        this.dismissed.set(false);
        this.soundAlarm();
      }
    } else {
      this.active.set(null);
    }
  }

  /** Three short beeps and a vibration. Browsers may block sound until the user has clicked on the page. */
  private soundAlarm() {
    try {
      navigator.vibrate?.([300, 150, 300, 150, 300]);
    } catch {
      // Vibration is optional.
    }
    try {
      const audio = new AudioContext();
      for (let i = 0; i < 3; i++) {
        const start = audio.currentTime + i * 0.35;
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.25);
      }
      setTimeout(() => void audio.close(), 1500);
    } catch {
      // No audio available; the banner still shows.
    }
  }
}
