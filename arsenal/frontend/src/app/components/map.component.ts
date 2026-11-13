import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { compass, formatDistance } from '../geo';
import { MapType } from '../models';
import { LayersService } from '../services/layers.service';
import { MapService } from '../services/map.service';
import { WaterService } from '../services/water.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-map',
  imports: [IconComponent],
  template: `
    <div #canvas class="canvas"></div>

    @switch (maps.status()) {
      @case ('loading') {
        <div class="overlay"><div class="spinner"></div><p>Loading map…</p></div>
      }
      @case ('api-down') {
        <div class="overlay">
          <h2>Can't reach the Arsenal API</h2>
          <p>Start the Django backend, then reload this page.</p>
          <pre>cd arsenal/backend
.venv\\Scripts\\python manage.py runserver</pre>
        </div>
      }
      @case ('no-key') {
        <div class="overlay">
          <h2>Add your Google Maps API key</h2>
          <p>The backend is running, but it has no <code>GOOGLE_MAPS_API_KEY</code>. Set it and restart Django:</p>
          <pre>$env:GOOGLE_MAPS_API_KEY = "your-key"
.venv\\Scripts\\python manage.py runserver</pre>
          <p class="hint">
            Enable <b>Maps JavaScript API</b>, <b>Places API (New)</b>, <b>Routes API</b> and <b>Geocoding API</b>
            on the key's Google Cloud project.
          </p>
        </div>
      }
      @case ('error') {
        <div class="overlay">
          <h2>Google Maps could not start</h2>
          <p>{{ maps.errorDetail() }}</p>
        </div>
      }
    }

    @if (maps.status() === 'ready') {
      <div class="controls">
        <div class="stack">
          <button type="button" aria-label="Zoom in" (click)="maps.zoomBy(1)"><app-icon name="add" /></button>
          <button type="button" aria-label="Zoom out" (click)="maps.zoomBy(-1)"><app-icon name="remove" /></button>
        </div>
        <button
          type="button"
          class="single"
          [attr.aria-label]="maps.following() ? 'Stop following my location' : maps.tracking() ? 'Re-centre on my location' : 'Show my location'"
          [attr.aria-pressed]="maps.tracking()"
          [class.busy]="maps.locating()"
          [class.following]="maps.following()"
          [class.tracking]="maps.tracking() && !maps.following()"
          (click)="maps.locateMe()"
        >
          <app-icon name="locate" />
        </button>
      </div>

      <div class="legend" aria-label="Map layers">
        @for (layer of layers.layers; track layer.id) {
          <label>
            <input type="checkbox" [checked]="layers.enabled()[layer.id]" (change)="layers.toggle(layer.id)" />
            <i [style.background]="layer.color"></i>
            {{ layer.label }}
            @if (layers.counts()[layer.id]) {
              <span>{{ layers.counts()[layer.id].toLocaleString() }}</span>
            }
          </label>
        }
        <label>
          <input type="checkbox" [checked]="water.enabled()" (change)="water.toggle()" />
          <i style="background: #1e88e5"></i>
          Nearest flowing water
        </label>
        @if (layers.zoomedOut()) {
          <p>Zoom in to a city to load hospitals, pharmacies, grocery stores and ammunition shops.</p>
        } @else if (layers.loadingTiles() > 0) {
          <p>Loading places…</p>
        }
      </div>

      @if (water.enabled()) {
        <button type="button" class="water" (click)="water.showBoth()" [disabled]="water.status() !== 'found'">
          @switch (water.status()) {
            @case ('found') {
              <app-icon name="arrow" [size]="30" [style.transform]="'rotate(' + water.result()!.bearing_deg + 'deg)'" />
              <span class="text">
                <b>{{ water.result()!.name || waterKind(water.result()!.kind) }}</b>
                <span>
                  {{ distance(water.result()!.distance_m!) }} {{ compass(water.result()!.bearing_deg!) }}
                  · from {{ water.source() === 'you' ? 'your location' : 'map centre' }}
                </span>
              </span>
            }
            @case ('none') {
              <app-icon name="arrow" [size]="30" />
              <span class="text">
                <b>No flowing water found</b>
                <span>None within {{ distance(water.result()?.searched_m ?? 0) }}{{ water.result()?.incomplete ? ' (wider search timed out)' : '' }}</span>
              </span>
            }
            @case ('error') {
              <app-icon name="arrow" [size]="30" />
              <span class="text"><b>Water lookup unavailable</b><span>Map data is busy. It will retry when you move.</span></span>
            }
            @default {
              <span class="spinner small"></span>
              <span class="text"><b>Finding nearest flowing water…</b></span>
            }
          }
        </button>
      }

      <div class="layers">
        @if (layersOpen()) {
          <div class="menu" role="menu">
            @for (t of types; track t.value) {
              <button type="button" role="menuitemradio" [class.on]="maps.mapType() === t.value" (click)="setType(t.value)">
                {{ t.label }}
              </button>
            }
            <hr />
            <button type="button" role="menuitemcheckbox" [class.on]="maps.traffic()" (click)="maps.toggleTraffic()">
              <app-icon name="traffic" [size]="18" /> Traffic
            </button>
          </div>
        }
        <button type="button" class="single" aria-label="Map layers" (click)="layersOpen.set(!layersOpen())">
          <app-icon name="layers" />
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-height: 0;
      background: var(--map-bg);
    }
    .canvas {
      position: absolute;
      inset: 0;
    }
    .overlay {
      position: absolute;
      inset: 0;
      z-index: 5;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 24px;
      text-align: center;
      background: var(--map-bg);
      color: var(--text);
    }
    h2 {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
    }
    p {
      max-width: 460px;
      margin: 4px 0;
      color: var(--text-2);
      line-height: 1.5;
    }
    pre {
      margin: 8px 0;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font-size: 13px;
      text-align: left;
    }
    code {
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--surface);
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--border);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .controls {
      position: absolute;
      right: 16px;
      bottom: 28px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .legend {
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 14px 8px 10px;
      border-radius: 8px;
      background: var(--bg);
      box-shadow: var(--shadow-1);
      font-size: 13px;
    }
    .legend label {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      cursor: pointer;
    }
    .legend i {
      width: 12px;
      height: 12px;
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    }
    .legend label span {
      color: var(--text-2);
    }
    .legend p {
      max-width: 210px;
      margin: 4px 0 0 24px;
      color: var(--text-2);
      font-size: 12px;
      line-height: 1.35;
    }
    .water {
      position: absolute;
      top: 16px;
      left: 50%;
      z-index: 4;
      display: flex;
      align-items: center;
      gap: 12px;
      width: auto;
      max-width: min(92%, 420px);
      height: auto;
      padding: 8px 18px 8px 12px;
      transform: translateX(-50%);
      border-radius: 28px;
      background: var(--bg);
      color: var(--text);
      box-shadow: var(--shadow-2);
      font: inherit;
      text-align: left;
    }
    .water app-icon {
      color: #1e88e5;
    }
    .water .text {
      display: flex;
      flex-direction: column;
      font-size: 13px;
      line-height: 1.3;
    }
    .water .text b {
      font-size: 14px;
      font-weight: 500;
    }
    .water .text span {
      color: var(--text-2);
    }
    .spinner.small {
      width: 22px;
      height: 22px;
      border-width: 2px;
    }
    .layers {
      position: absolute;
      left: 16px;
      bottom: 28px;
      z-index: 4;
    }
    button {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border: 0;
      background: var(--bg);
      color: var(--text-2);
      cursor: pointer;
    }
    button:hover {
      background: var(--hover);
      color: var(--text);
    }
    .stack {
      overflow: hidden;
      border-radius: 8px;
      box-shadow: var(--shadow-1);
    }
    .stack button + button {
      border-top: 1px solid var(--border);
    }
    .single {
      border-radius: 8px;
      box-shadow: var(--shadow-1);
    }
    .following {
      background: var(--primary);
      color: #fff;
    }
    .following:hover {
      background: var(--primary-dark);
      color: #fff;
    }
    .tracking {
      color: var(--primary);
    }
    .busy {
      color: var(--primary);
      animation: pulse 1s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        opacity: 0.4;
      }
    }
    .menu {
      position: absolute;
      bottom: 48px;
      left: 0;
      width: 160px;
      padding: 6px 0;
      border-radius: 8px;
      background: var(--bg);
      box-shadow: var(--shadow-2);
    }
    .menu button {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 36px;
      padding: 0 16px;
      font: inherit;
      font-size: 14px;
      text-align: left;
      justify-content: flex-start;
    }
    .menu button.on {
      color: var(--primary);
      font-weight: 600;
    }
    hr {
      margin: 4px 0;
      border: 0;
      border-top: 1px solid var(--border);
    }
  `,
})
export class MapComponent implements AfterViewInit {
  protected readonly maps = inject(MapService);
  protected readonly layers = inject(LayersService);
  protected readonly water = inject(WaterService);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');

  protected readonly layersOpen = signal(false);
  protected readonly types: { value: MapType; label: string }[] = [
    { value: 'roadmap', label: 'Default' },
    { value: 'hybrid', label: 'Satellite' },
    { value: 'terrain', label: 'Terrain' },
  ];

  ngAfterViewInit() {
    void this.maps.init(this.canvas().nativeElement);
  }

  protected readonly distance = formatDistance;
  protected readonly compass = compass;

  protected waterKind(kind: string | undefined): string {
    return kind === 'stream' ? 'Unnamed stream' : kind === 'canal' ? 'Unnamed canal' : 'Unnamed river';
  }

  protected setType(type: MapType) {
    this.maps.setMapType(type);
    this.layersOpen.set(false);
  }
}
