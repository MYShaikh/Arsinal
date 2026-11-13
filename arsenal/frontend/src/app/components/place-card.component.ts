import { Component, computed, inject, input, output, signal } from '@angular/core';

import { CATEGORIES, Category, PlaceInfo } from '../models';
import { PlacesStore } from '../services/places.store';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-place-card',
  imports: [IconComponent],
  template: `
    @let p = place();
    <article>
      @if (p.photoUrl) {
        <img class="photo" [src]="p.photoUrl" [alt]="p.name" />
      }
      <div class="body">
        <h2>{{ p.name }}</h2>
        @if (p.description) {
          <div class="desc">{{ p.description }}</div>
        }
        @if (p.rating) {
          <div class="rating">
            <b>{{ p.rating.toFixed(1) }}</b>
            <span class="stars" [style.--fill.%]="(p.rating / 5) * 100" aria-hidden="true">★★★★★</span>
            @if (p.ratingCount) {
              <span class="muted">({{ p.ratingCount.toLocaleString() }})</span>
            }
          </div>
        }
        @if (p.openNow !== undefined) {
          <div class="open" [class.closed]="!p.openNow">{{ p.openNow ? 'Open now' : 'Closed' }}</div>
        }

        <div class="actions">
          <button type="button" class="primary" (click)="directions.emit(p)">
            <app-icon name="directions" [size]="18" /> Directions
          </button>
          @if (savedMatch(); as s) {
            <button type="button" class="on" (click)="unsave(s.id)">
              <app-icon name="bookmark" [size]="18" /> Saved
            </button>
          } @else {
            <button type="button" (click)="save()"><app-icon name="bookmark" [size]="18" /> Save</button>
          }
        </div>

        @if (savedMatch(); as s) {
          <div class="chips" role="radiogroup" aria-label="Saved as">
            @for (c of categories; track c.value) {
              <button
                type="button"
                role="radio"
                class="chip"
                [class.sel]="s.category === c.value"
                [attr.aria-checked]="s.category === c.value"
                (click)="store.setCategory(s.id, c.value)"
              >
                <i [style.background]="c.color"></i>{{ c.label }}
              </button>
            }
          </div>
        }

        <ul class="facts">
          @if (p.address) {
            <li>
              <app-icon name="place" [size]="20" />
              <span>{{ p.address }}</span>
            </li>
          }
          @if (p.phone) {
            <li>
              <app-icon name="phone" [size]="20" />
              <a [href]="'tel:' + p.phone">{{ p.phone }}</a>
            </li>
          }
          @if (p.website) {
            <li>
              <app-icon name="globe" [size]="20" />
              <a [href]="p.website" target="_blank" rel="noopener noreferrer">{{ host() }}</a>
            </li>
          }
          @if (p.hours?.length) {
            <li>
              <app-icon name="clock" [size]="20" />
              <div>
                <button type="button" class="link" (click)="showHours.set(!showHours())">
                  {{ showHours() ? 'Hide hours' : 'Show hours' }}
                </button>
                @if (showHours()) {
                  @for (line of p.hours; track line) {
                    <div class="hours">{{ line }}</div>
                  }
                }
              </div>
            </li>
          }
          <li class="coords">
            <app-icon name="explore" [size]="20" />
            <span>{{ p.lat.toFixed(5) }}, {{ p.lng.toFixed(5) }}</span>
          </li>
        </ul>
      </div>
    </article>
  `,
  styles: `
    .photo {
      display: block;
      width: 100%;
      height: 180px;
      object-fit: cover;
    }
    .body {
      padding: 16px 20px 20px;
    }
    h2 {
      margin: 0 0 4px;
      font-size: 22px;
      font-weight: 400;
      line-height: 1.25;
    }
    .desc {
      margin-bottom: 4px;
      color: var(--text-2);
      font-size: 14px;
      line-height: 1.4;
    }
    .rating {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }
    .stars {
      --fill: 0%;
      background: linear-gradient(90deg, #fbbc04 var(--fill), var(--border) var(--fill));
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      letter-spacing: 1px;
    }
    .muted {
      color: var(--text-2);
    }
    .open {
      margin-top: 2px;
      color: #188038;
      font-size: 14px;
    }
    .open.closed {
      color: #d93025;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin: 16px 0 12px;
    }
    .actions button,
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: var(--bg);
      color: var(--primary);
      font: inherit;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    .actions button:hover,
    .chip:hover {
      background: var(--hover);
    }
    .actions .primary {
      border-color: transparent;
      background: var(--primary);
      color: #fff;
    }
    .actions .primary:hover {
      background: var(--primary-dark);
    }
    .actions .on {
      background: var(--primary-tint);
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }
    .chip {
      height: 30px;
      padding: 0 12px;
      color: var(--text-2);
      font-size: 13px;
      font-weight: 400;
    }
    .chip i {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .chip.sel {
      border-color: var(--primary);
      background: var(--primary-tint);
      color: var(--text);
    }
    .facts {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .facts li {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding: 10px 0;
      border-top: 1px solid var(--border);
      color: var(--text);
      font-size: 14px;
      line-height: 1.4;
    }
    .facts app-icon {
      color: var(--primary);
    }
    .facts a {
      color: var(--text);
      text-decoration: none;
    }
    .facts a:hover {
      text-decoration: underline;
    }
    .coords {
      color: var(--text-2);
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--text);
      font: inherit;
      cursor: pointer;
    }
    .hours {
      margin-top: 4px;
      color: var(--text-2);
    }
  `,
})
export class PlaceCardComponent {
  protected readonly store = inject(PlacesStore);

  readonly place = input.required<PlaceInfo>();
  readonly directions = output<PlaceInfo>();

  protected readonly categories = CATEGORIES;
  protected readonly showHours = signal(false);
  protected readonly savedMatch = computed(() => {
    this.store.saved(); // re-evaluate whenever the saved list changes
    return this.store.savedMatch(this.place());
  });
  protected readonly host = computed(() => {
    try {
      return new URL(this.place().website ?? '').hostname.replace(/^www\./, '');
    } catch {
      return this.place().website ?? '';
    }
  });

  protected save(category: Category = 'favorite') {
    void this.store.save(this.place(), category);
  }

  protected unsave(id: number) {
    void this.store.remove(id);
  }
}
