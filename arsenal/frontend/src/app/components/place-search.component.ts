import { Component, inject, input, model, output, signal } from '@angular/core';

import { PlaceInfo, Suggestion } from '../models';
import { MapService } from '../services/map.service';
import { IconComponent } from './icon.component';

/** Text box with Google Places autocomplete. Emits the full place once a suggestion is chosen. */
@Component({
  selector: 'app-place-search',
  imports: [IconComponent],
  template: `
    <div class="box" [class.open]="open()">
      <app-icon [name]="icon()" [size]="20" />
      <input
        type="text"
        role="combobox"
        autocomplete="off"
        [attr.aria-expanded]="open()"
        [placeholder]="placeholder()"
        [value]="text()"
        (input)="onInput($any($event.target).value)"
        (focus)="open.set(suggestions().length > 0)"
        (blur)="open.set(false)"
        (keydown)="onKey($event)"
      />
      @if (text()) {
        <button type="button" class="clear" aria-label="Clear" (mousedown)="$event.preventDefault()" (click)="clear()">
          <app-icon name="close" [size]="18" />
        </button>
      }
    </div>
    @if (open()) {
      <ul class="list" role="listbox">
        @for (s of suggestions(); track s.prediction.placeId; let i = $index) {
          <li role="option" [class.active]="i === active()" (mousedown)="$event.preventDefault(); pick(s)">
            <app-icon name="place" [size]="20" />
            <span class="main">{{ s.main }}</span>
            <span class="secondary">{{ s.secondary }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .box {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 46px;
      padding: 0 8px 0 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 24px;
      color: var(--text-2);
      transition:
        box-shadow 0.15s,
        border-color 0.15s;
    }
    .box:focus-within {
      border-color: transparent;
      box-shadow: var(--shadow-2);
      background: var(--bg);
    }
    .box.open {
      border-radius: 24px 24px 0 0;
    }
    input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 15px;
    }
    .clear {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
    }
    .clear:hover {
      background: var(--hover);
    }
    .list {
      position: absolute;
      z-index: 30;
      inset: 46px 0 auto;
      margin: 0;
      padding: 4px 0 8px;
      list-style: none;
      background: var(--bg);
      border-radius: 0 0 16px 16px;
      box-shadow: var(--shadow-2);
    }
    li {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 9px 16px;
      color: var(--text-2);
      cursor: pointer;
      white-space: nowrap;
    }
    li:hover,
    li.active {
      background: var(--hover);
    }
    .main {
      color: var(--text);
      font-size: 14px;
    }
    .secondary {
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 13px;
    }
  `,
})
export class PlaceSearchComponent {
  readonly placeholder = input('Search places');
  readonly icon = input('search');
  readonly text = model('');
  readonly picked = output<PlaceInfo>();
  readonly cleared = output<void>();

  protected readonly suggestions = signal<Suggestion[]>([]);
  protected readonly open = signal(false);
  protected readonly active = signal(-1);

  private readonly maps = inject(MapService);
  private timer?: ReturnType<typeof setTimeout>;
  private requestId = 0;

  protected onInput(value: string) {
    this.text.set(value);
    this.active.set(-1);
    clearTimeout(this.timer);
    if (!value.trim()) {
      this.suggestions.set([]);
      this.open.set(false);
      return;
    }
    const id = ++this.requestId;
    this.timer = setTimeout(async () => {
      const results = await this.maps.suggest(value);
      if (id !== this.requestId) return; // a newer keystroke superseded this request
      this.suggestions.set(results);
      this.open.set(results.length > 0);
    }, 200);
  }

  protected onKey(event: KeyboardEvent) {
    const list = this.suggestions();
    if (event.key === 'ArrowDown' && list.length) {
      event.preventDefault();
      this.open.set(true);
      this.active.set((this.active() + 1) % list.length);
    } else if (event.key === 'ArrowUp' && list.length) {
      event.preventDefault();
      this.active.set((this.active() - 1 + list.length) % list.length);
    } else if (event.key === 'Enter') {
      const choice = list[this.active()] ?? list[0];
      if (choice) void this.pick(choice);
    } else if (event.key === 'Escape') {
      this.open.set(false);
    }
  }

  protected async pick(suggestion: Suggestion) {
    this.open.set(false);
    this.suggestions.set([]);
    this.requestId++;
    this.text.set(suggestion.main);
    try {
      this.picked.emit(await this.maps.resolve(suggestion));
    } catch {
      this.text.set('');
    }
  }

  protected clear() {
    this.requestId++;
    this.text.set('');
    this.suggestions.set([]);
    this.open.set(false);
    this.cleared.emit();
  }
}
