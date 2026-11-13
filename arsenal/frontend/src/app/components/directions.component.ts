import { Component, effect, inject, input, signal, untracked } from '@angular/core';

import { PlaceInfo, TravelMode } from '../models';
import { MapService } from '../services/map.service';
import { IconComponent } from './icon.component';
import { PlaceSearchComponent } from './place-search.component';

@Component({
  selector: 'app-directions',
  imports: [IconComponent, PlaceSearchComponent],
  template: `
    <div class="modes" role="radiogroup" aria-label="Travel mode">
      @for (m of modes; track m.value) {
        <button
          type="button"
          role="radio"
          [class.sel]="mode() === m.value"
          [attr.aria-checked]="mode() === m.value"
          [attr.aria-label]="m.label"
          (click)="setMode(m.value)"
        >
          <app-icon [name]="m.icon" />
        </button>
      }
    </div>

    <div class="fields">
      <div class="field">
        <app-place-search
          icon="locate"
          placeholder="Choose starting point"
          [(text)]="originText"
          (picked)="setOrigin($event)"
          (cleared)="origin.set(null)"
        />
        <button type="button" class="here" (click)="useMyLocation()" [disabled]="maps.locating()">
          <app-icon name="locate" [size]="16" /> Use my location
        </button>
      </div>
      <button type="button" class="swap" aria-label="Swap start and destination" (click)="swap()">
        <app-icon name="swap" />
      </button>
      <app-place-search
        icon="place"
        placeholder="Choose destination"
        [(text)]="destText"
        (picked)="setDest($event)"
        (cleared)="dest.set(null)"
      />
    </div>

    @if (loading()) {
      <p class="note">Finding the best route…</p>
    } @else if (error()) {
      <p class="note error">{{ error() }}</p>
    } @else if (maps.route(); as r) {
      <div class="summary">
        <span class="time">{{ r.duration }}</span>
        <span class="dist">({{ r.distance }})</span>
      </div>
      <ol class="steps">
        @for (s of r.steps; track $index) {
          <li>
            <span>{{ s.instructions }}</span>
            <span class="sd">{{ s.distance }}</span>
          </li>
        }
      </ol>
    } @else {
      <p class="note">Choose a start and destination to see directions.</p>
    }
  `,
  styles: `
    .modes {
      display: flex;
      gap: 4px;
      padding: 12px 16px 4px;
    }
    .modes button {
      display: grid;
      place-items: center;
      width: 44px;
      height: 40px;
      border: 0;
      border-radius: 20px;
      background: none;
      color: var(--text-2);
      cursor: pointer;
    }
    .modes button:hover {
      background: var(--hover);
    }
    .modes button.sel {
      background: var(--primary-tint);
      color: var(--primary);
    }
    .fields {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 8px 16px 12px;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .here {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-left: 8px;
      padding: 4px 8px;
      border: 0;
      border-radius: 12px;
      background: none;
      color: var(--primary);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .here:hover {
      background: var(--primary-tint);
    }
    .swap {
      position: absolute;
      top: 50%;
      right: 24px;
      z-index: 2;
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      margin-top: -8px;
      border: 1px solid var(--border);
      border-radius: 50%;
      background: var(--bg);
      color: var(--text-2);
      cursor: pointer;
    }
    .swap:hover {
      background: var(--hover);
    }
    .note {
      margin: 16px 20px;
      color: var(--text-2);
      line-height: 1.5;
    }
    .note.error {
      color: #d93025;
    }
    .summary {
      display: flex;
      align-items: baseline;
      gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid var(--border);
    }
    .time {
      color: #188038;
      font-size: 22px;
    }
    .dist {
      color: var(--text-2);
    }
    .steps {
      margin: 0;
      padding: 0 20px 20px 40px;
      font-size: 14px;
      line-height: 1.4;
    }
    .steps li {
      padding: 8px 0;
      border-top: 1px solid var(--border);
    }
    .sd {
      display: block;
      color: var(--text-2);
      font-size: 12px;
    }
  `,
})
export class DirectionsComponent {
  protected readonly maps = inject(MapService);

  /** Pre-fills the destination, e.g. from the Directions button on a place card. */
  readonly destination = input<PlaceInfo | null>(null);

  protected readonly modes: { value: TravelMode; icon: string; label: string }[] = [
    { value: 'DRIVING', icon: 'car', label: 'Driving' },
    { value: 'TRANSIT', icon: 'transit', label: 'Transit' },
    { value: 'WALKING', icon: 'walk', label: 'Walking' },
    { value: 'BICYCLING', icon: 'bike', label: 'Cycling' },
  ];

  protected readonly mode = signal<TravelMode>('DRIVING');
  protected readonly origin = signal<google.maps.LatLngLiteral | null>(null);
  protected readonly dest = signal<google.maps.LatLngLiteral | null>(null);
  protected readonly originText = signal('');
  protected readonly destText = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  private requestId = 0;

  constructor() {
    effect(() => {
      const d = this.destination();
      if (!d) return;
      untracked(() => this.setDest(d));
    });
  }

  protected setMode(mode: TravelMode) {
    this.mode.set(mode);
    void this.compute();
  }

  protected setOrigin(place: PlaceInfo) {
    this.origin.set({ lat: place.lat, lng: place.lng });
    this.originText.set(place.name);
    void this.compute();
  }

  protected setDest(place: PlaceInfo) {
    this.dest.set({ lat: place.lat, lng: place.lng });
    this.destText.set(place.name);
    void this.compute();
  }

  protected async useMyLocation() {
    const here = await this.maps.locate();
    if (!here) return;
    this.origin.set(here);
    this.originText.set('Your location');
    void this.compute();
  }

  protected swap() {
    const [o, d, ot, dt] = [this.origin(), this.dest(), this.originText(), this.destText()];
    this.origin.set(d);
    this.dest.set(o);
    this.originText.set(dt);
    this.destText.set(ot);
    void this.compute();
  }

  private async compute() {
    const [origin, dest] = [this.origin(), this.dest()];
    const id = ++this.requestId;
    this.error.set('');
    if (!origin || !dest) {
      this.maps.clearRoute();
      return;
    }
    this.loading.set(true);
    try {
      await this.maps.showRoute(origin, dest, this.mode());
    } catch {
      if (id === this.requestId) {
        this.maps.clearRoute();
        this.error.set(`No ${this.mode().toLowerCase()} route found between those places.`);
      }
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }
}
