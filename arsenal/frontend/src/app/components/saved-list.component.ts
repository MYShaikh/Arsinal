import { Component, computed, inject, signal } from '@angular/core';

import { CATEGORIES, Category, SavedPlace } from '../models';
import { MapService } from '../services/map.service';
import { PlacesStore } from '../services/places.store';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-saved-list',
  imports: [IconComponent],
  template: `
    <div class="filters">
      <button type="button" [class.sel]="!filter()" (click)="filter.set(null)">All ({{ store.saved().length }})</button>
      @for (c of categories; track c.value) {
        <button type="button" [class.sel]="filter() === c.value" (click)="filter.set(c.value)">
          <i [style.background]="c.color"></i>{{ c.label }}
        </button>
      }
    </div>

    @if (visible().length === 0) {
      <p class="empty">
        {{ store.saved().length ? 'Nothing in this list yet.' : 'No saved places yet. Search for a place and press Save.' }}
      </p>
    }
    <ul>
      @for (s of visible(); track s.id) {
        <li>
          <button type="button" class="row" (click)="open(s)">
            <span class="dot" [style.background]="colorOf(s.category)"><app-icon name="place" [size]="18" /></span>
            <span class="text">
              <span class="name">{{ s.name }}</span>
              <span class="addr">{{ s.address }}</span>
            </span>
          </button>
          <button type="button" class="del" aria-label="Remove {{ s.name }}" (click)="store.remove(s.id)">
            <app-icon name="delete" [size]="20" />
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 12px 16px;
    }
    .filters button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 30px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 15px;
      background: var(--bg);
      color: var(--text-2);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
    }
    .filters button.sel {
      border-color: var(--primary);
      background: var(--primary-tint);
      color: var(--text);
    }
    i {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .empty {
      margin: 24px 20px;
      color: var(--text-2);
      line-height: 1.5;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      border-top: 1px solid var(--border);
    }
    .row {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 14px;
      min-width: 0;
      padding: 12px 8px 12px 20px;
      border: 0;
      background: none;
      color: var(--text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row:hover {
      background: var(--hover);
    }
    .dot {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      color: #fff;
      flex: none;
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .name {
      font-size: 14px;
      font-weight: 500;
    }
    .addr {
      overflow: hidden;
      color: var(--text-2);
      font-size: 13px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .del {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      margin-right: 12px;
      border: 0;
      border-radius: 50%;
      background: none;
      color: var(--text-2);
      cursor: pointer;
    }
    .del:hover {
      background: var(--hover);
      color: #d93025;
    }
  `,
})
export class SavedListComponent {
  protected readonly store = inject(PlacesStore);
  private readonly maps = inject(MapService);

  protected readonly categories = CATEGORIES;
  protected readonly filter = signal<Category | null>(null);
  protected readonly visible = computed(() => {
    const f = this.filter();
    return f ? this.store.saved().filter((s) => s.category === f) : this.store.saved();
  });

  protected colorOf(category: Category) {
    return CATEGORIES.find((c) => c.value === category)?.color ?? '#d93025';
  }

  protected open(s: SavedPlace) {
    this.maps.show({
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      placeId: s.google_place_id || undefined,
    });
  }
}
