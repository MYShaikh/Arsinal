import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';

import { MapType } from '../models';
import { MapService } from '../services/map.service';
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
          aria-label="Show my location"
          [class.busy]="maps.locating()"
          (click)="maps.locate()"
        >
          <app-icon name="locate" />
        </button>
      </div>

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

  protected setType(type: MapType) {
    this.maps.setMapType(type);
    this.layersOpen.set(false);
  }
}
