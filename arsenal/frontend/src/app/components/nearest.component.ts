import { HttpClient } from '@angular/common/http';
import { Component, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { compass, formatDistance } from '../geo';
import { NearestCategory, NearestResult, RouteRequest, TravelMode } from '../models';
import { MapService } from '../services/map.service';
import { ToastService } from '../services/toast.service';
import { IconComponent } from './icon.component';

interface Row {
  id: NearestCategory;
  label: string;
  singular: string;
  color: string;
}

/** Finds the closest place of a type and asks the sidebar to route there on foot or by car. */
@Component({
  selector: 'app-nearest',
  imports: [IconComponent],
  template: `
    <div class="modes" role="radiogroup" aria-label="How you are travelling">
      <button type="button" role="radio" [class.sel]="mode() === 'WALKING'" [attr.aria-checked]="mode() === 'WALKING'" (click)="mode.set('WALKING')">
        <app-icon name="walk" [size]="20" /> Walk
      </button>
      <button type="button" role="radio" [class.sel]="mode() === 'DRIVING'" [attr.aria-checked]="mode() === 'DRIVING'" (click)="mode.set('DRIVING')">
        <app-icon name="car" [size]="20" /> Drive
      </button>
    </div>

    <h3>Go to the nearest</h3>
    <ul>
      @for (row of rows; track row.id) {
        <li>
          <button type="button" class="row" [disabled]="state()[row.id]?.loading" (click)="go(row)">
            <i [style.background]="row.color"></i>
            <span class="text">
              <span class="name">{{ row.label }}</span>
              @if (state()[row.id]; as s) {
                <span class="detail" [class.error]="s.error">{{ s.loading ? 'Searching…' : s.text }}</span>
              }
            </span>
            <app-icon name="directions" [size]="20" />
          </button>
        </li>
      }
    </ul>
    <p class="hint">
      Measured from your location when it is on, otherwise from the centre of the map. Places come from OpenStreetMap, so
      a search can take a few seconds.
    </p>
  `,
  styles: `
    .modes {
      display: flex;
      gap: 8px;
      padding: 14px 16px 6px;
    }
    .modes button {
      display: inline-flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      gap: 8px;
      height: 38px;
      border: 1px solid var(--border);
      border-radius: 19px;
      background: var(--bg);
      color: var(--text-2);
      font: inherit;
      font-size: 14px;
      cursor: pointer;
    }
    .modes button.sel {
      border-color: var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
      font-weight: 500;
    }
    h3 {
      margin: 0;
      padding: 12px 20px 6px;
      color: var(--text-2);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.6px;
      text-transform: uppercase;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      padding: 12px 20px;
      border: 0;
      border-top: 1px solid var(--border);
      background: none;
      color: var(--primary);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row:hover:not(:disabled) {
      background: var(--hover);
    }
    .row:disabled {
      cursor: progress;
    }
    i {
      flex: none;
      width: 14px;
      height: 14px;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    }
    .text {
      display: flex;
      flex: 1;
      flex-direction: column;
      min-width: 0;
    }
    .name {
      color: var(--text);
      font-size: 14px;
      font-weight: 500;
    }
    .detail {
      color: var(--text-2);
      font-size: 13px;
      line-height: 1.35;
    }
    .detail.error {
      color: #d93025;
    }
    .hint {
      margin: 12px 20px;
      color: var(--text-2);
      font-size: 13px;
      line-height: 1.45;
    }
  `,
})
export class NearestComponent {
  private readonly http = inject(HttpClient);
  private readonly maps = inject(MapService);
  private readonly toast = inject(ToastService);

  readonly route = output<RouteRequest>();

  protected readonly mode = signal<TravelMode>('WALKING');
  protected readonly state = signal<Partial<Record<NearestCategory, { loading?: boolean; text?: string; error?: boolean }>>>({});
  protected readonly rows: Row[] = [
    { id: 'hospital', label: 'Hospital', singular: 'Hospital', color: '#d93025' },
    { id: 'pharmacy', label: 'Pharmacy', singular: 'Pharmacy', color: '#188038' },
    { id: 'grocery', label: 'Grocery store', singular: 'Grocery store', color: '#ef6c00' },
    { id: 'ammo', label: 'Ammunition shop', singular: 'Ammunition shop', color: '#3c4043' },
    { id: 'water', label: 'Flowing water', singular: 'Flowing water', color: '#1e88e5' },
    { id: 'nuclear', label: 'Nuclear power plant', singular: 'Nuclear power plant', color: '#e53935' },
  ];

  private askedForLocation = false;

  protected async go(row: Row) {
    let reference = this.maps.referencePoint();
    if (reference?.source !== 'you' && !this.askedForLocation) {
      // Ask for the real position once; if it is refused, the map centre is used from then on.
      this.askedForLocation = true;
      const here = await this.maps.locate();
      if (here) reference = { ...here, source: 'you' };
    }
    if (!reference) {
      this.toast.show('The map is not ready yet.');
      return;
    }
    const origin = { lat: reference.lat, lng: reference.lng };

    this.setState(row.id, { loading: true });
    let result: NearestResult;
    try {
      result = await firstValueFrom(
        this.http.get<NearestResult>(`${API_BASE}/nearest/`, { params: { ...origin, category: row.id } }),
      );
    } catch {
      this.setState(row.id, { text: 'Map data is busy. Try again in a moment.', error: true });
      return;
    }
    if (!result.found) {
      const reach = result.searched_m ? ` within ${formatDistance(result.searched_m)}` : '';
      this.setState(row.id, { text: `None found${reach}${result.incomplete ? ' (a wider search timed out)' : ''}.` });
      return;
    }

    const name = result.name || row.singular;
    this.setState(row.id, { text: `${name} · ${formatDistance(result.distance_m!)} ${compass(result.bearing_deg!)}` });
    this.route.emit({
      destination: { name, address: '', description: row.singular, lat: result.lat!, lng: result.lng! },
      origin: { ...origin, name: reference.source === 'you' ? 'Your location' : 'Map centre' },
      mode: this.mode(),
    });
  }

  private setState(id: NearestCategory, value: { loading?: boolean; text?: string; error?: boolean }) {
    this.state.update((s) => ({ ...s, [id]: value }));
  }
}
