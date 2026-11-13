import { Component, inject, signal } from '@angular/core';

import { PlaceInfo, RecentSearch, RouteRequest } from '../models';
import { MapService } from '../services/map.service';
import { PlacesStore } from '../services/places.store';
import { DirectionsComponent } from './directions.component';
import { IconComponent } from './icon.component';
import { IdentifyComponent } from './identify.component';
import { NearestComponent } from './nearest.component';
import { PlaceCardComponent } from './place-card.component';
import { PlaceSearchComponent } from './place-search.component';
import { SavedListComponent } from './saved-list.component';

type View = 'explore' | 'nearest' | 'identify' | 'saved' | 'directions';

@Component({
  selector: 'app-sidebar',
  imports: [IconComponent, PlaceSearchComponent, PlaceCardComponent, SavedListComponent, DirectionsComponent, NearestComponent, IdentifyComponent],
  template: `
    <header>
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="arsenal-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#ff7a45" />
            <stop offset="1" stop-color="#d93025" />
          </linearGradient>
        </defs>
        <path
          d="M16 2C9.9 2 5 6.9 5 13c0 8.2 11 17 11 17s11-8.8 11-17c0-6.1-4.9-11-11-11z"
          fill="url(#arsenal-g)"
        />
        <path d="M16 7.5 21 19h-3l-.9-2.3h-2.2L14 19h-3l5-11.5zm0 5-.7 1.9h1.4L16 12.5z" fill="#fff" />
      </svg>
      <h1>Arsenal</h1>
    </header>

    @if (view() !== 'directions') {
      <div class="search">
        <app-place-search placeholder="Search places" [(text)]="query" (picked)="onPicked($event)" (cleared)="maps.clearSelection()" />
      </div>
    }

    <nav role="tablist">
      <button type="button" role="tab" [attr.aria-selected]="view() === 'explore'" [class.sel]="view() === 'explore'" (click)="go('explore')">
        <app-icon name="explore" [size]="20" /> Explore
      </button>
      <button type="button" role="tab" [attr.aria-selected]="view() === 'nearest'" [class.sel]="view() === 'nearest'" (click)="go('nearest')">
        <app-icon name="place" [size]="20" /> Nearest
      </button>
      <button type="button" role="tab" [attr.aria-selected]="view() === 'identify'" [class.sel]="view() === 'identify'" (click)="go('identify')">
        <app-icon name="camera" [size]="20" /> Identify
      </button>
      <button type="button" role="tab" [attr.aria-selected]="view() === 'saved'" [class.sel]="view() === 'saved'" (click)="go('saved')">
        <app-icon name="bookmark" [size]="20" /> Saved
        @if (store.saved().length) {
          <span class="count">{{ store.saved().length }}</span>
        }
      </button>
      <button type="button" role="tab" [attr.aria-selected]="view() === 'directions'" [class.sel]="view() === 'directions'" (click)="go('directions')">
        <app-icon name="directions" [size]="20" /> Directions
      </button>
    </nav>

    @if (store.offline()) {
      <div class="banner">
        Can't reach the Arsenal API, so saving places is unavailable.
        <button type="button" (click)="store.load()">Retry</button>
      </div>
    }

    <div class="content">
      @switch (view()) {
        @case ('explore') {
          @if (maps.selected(); as place) {
            <app-place-card [place]="place" (directions)="directionsTo($event)" />
          } @else {
            <div class="recents">
              <div class="recents-head">
                <h3>Recent</h3>
                @if (store.recents().length) {
                  <button type="button" (click)="store.clearRecents()">Clear</button>
                }
              </div>
              @for (r of store.recents(); track r.id) {
                <button type="button" class="recent" (click)="openRecent(r)">
                  <app-icon name="history" [size]="20" />
                  <span class="text">
                    <span class="name">{{ r.query }}</span>
                    <span class="addr">{{ r.address }}</span>
                  </span>
                </button>
              } @empty {
                <p class="hint">Search for a place, or click anywhere on the map to drop a pin.</p>
              }
            </div>
          }
        }
        @case ('nearest') {
          <app-nearest (route)="routeTo($event)" />
        }
        @case ('identify') {
          <app-identify />
        }
        @case ('saved') {
          <app-saved-list />
        }
        @case ('directions') {
          <app-directions [request]="routeRequest()" />
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      background: var(--bg);
      box-shadow: var(--shadow-1);
      z-index: 10;
    }
    header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 20px 6px;
    }
    .logo {
      width: 30px;
      height: 30px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 500;
      letter-spacing: 0.4px;
    }
    .search {
      padding: 8px 16px 12px;
    }
    nav {
      display: flex;
      border-bottom: 1px solid var(--border);
    }
    nav button {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 2px;
      height: 56px;
      padding: 0 2px;
      border: 0;
      border-bottom: 3px solid transparent;
      background: none;
      color: var(--text-2);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    nav button:hover {
      background: var(--hover);
    }
    nav button.sel {
      border-bottom-color: var(--primary);
      color: var(--primary);
      font-weight: 500;
    }
    .count {
      min-width: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--primary-tint);
      font-size: 12px;
      line-height: 18px;
    }
    .banner {
      padding: 10px 16px;
      background: #fef7e0;
      color: #3c4043;
      font-size: 13px;
    }
    .banner button {
      margin-left: 6px;
      border: 0;
      background: none;
      color: var(--primary);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .content {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .recents-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 20px 6px;
    }
    h3 {
      margin: 0;
      color: var(--text-2);
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    .recents-head button {
      border: 0;
      background: none;
      color: var(--primary);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .recent {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
      padding: 10px 20px;
      border: 0;
      background: none;
      color: var(--text-2);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .recent:hover {
      background: var(--hover);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .name {
      color: var(--text);
      font-size: 14px;
    }
    .addr {
      overflow: hidden;
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hint {
      margin: 12px 20px;
      color: var(--text-2);
      line-height: 1.5;
    }
  `,
})
export class SidebarComponent {
  protected readonly maps = inject(MapService);
  protected readonly store = inject(PlacesStore);

  protected readonly view = signal<View>('explore');
  protected readonly query = signal('');
  protected readonly routeRequest = signal<RouteRequest | null>(null);

  constructor() {
    void this.store.load();
  }

  protected go(view: View) {
    this.view.set(view);
    if (view !== 'directions') this.maps.clearRoute();
  }

  protected onPicked(place: PlaceInfo) {
    this.maps.show(place);
    void this.store.addRecent(place);
  }

  protected openRecent(r: RecentSearch) {
    if (r.google_place_id) {
      void this.maps.selectPlaceId(r.google_place_id);
    } else {
      this.maps.show({ name: r.query, address: r.address, lat: r.lat, lng: r.lng });
    }
  }

  protected directionsTo(place: PlaceInfo) {
    this.routeTo({ destination: place });
  }

  protected routeTo(request: RouteRequest) {
    this.maps.show(request.destination);
    this.routeRequest.set(request);
    this.view.set('directions');
  }
}
