import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { Edibility, IdentifyKind, IdentifyResult } from '../models';
import { MapService } from '../services/map.service';
import { IconComponent } from './icon.component';

const EDIBILITY: Record<Edibility, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null> = {
  edible: { label: 'Reported edible if correctly identified', tone: 'good' },
  edible_with_preparation: { label: 'Edible only with preparation', tone: 'warn' },
  not_edible: { label: 'Not edible', tone: 'neutral' },
  poisonous: { label: 'Poisonous', tone: 'bad' },
  unknown: { label: 'Edibility unknown', tone: 'neutral' },
  not_applicable: null,
};

/** Longest side sent to the server. Larger photos add upload time without improving the identification. */
const MAX_SIDE = 1568;

/** Photo identification: an animal track, or a plant, berry or fungus with what is known about eating it. */
@Component({
  selector: 'app-identify',
  imports: [IconComponent],
  template: `
    <div class="kinds" role="radiogroup" aria-label="What the photo shows">
      <button type="button" role="radio" [class.sel]="kind() === 'plant'" [attr.aria-checked]="kind() === 'plant'" (click)="setKind('plant')">
        Plant or berry
      </button>
      <button type="button" role="radio" [class.sel]="kind() === 'track'" [attr.aria-checked]="kind() === 'track'" (click)="setKind('track')">
        Animal track
      </button>
    </div>

    <div class="pick">
      <label class="btn">
        <app-icon name="camera" [size]="20" /> Take photo
        <input type="file" accept="image/*" capture="environment" (change)="onFile($event)" />
      </label>
      <label class="btn">
        <app-icon name="add" [size]="20" /> Choose image
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" (change)="onFile($event)" />
      </label>
    </div>

    @if (preview(); as src) {
      <img class="preview" [src]="src" alt="Photo to identify" />
      <label class="check">
        <input type="checkbox" [checked]="useLocation()" (change)="useLocation.set(!useLocation())" [disabled]="!maps.userLocation()" />
        <span>
          Use my rough location to narrow down species
          <small>{{ maps.userLocation() ? 'Only the area, to about 10 km, is sent.' : 'Turn on location with the map\\'s location button to use this.' }}</small>
        </span>
      </label>
      <button type="button" class="go" [disabled]="loading()" (click)="identify()">
        {{ loading() ? 'Analysing photo…' : kind() === 'plant' ? 'Identify plant' : 'Identify track' }}
      </button>
      @if (loading()) {
        <p class="note">This usually takes 10 to 40 seconds.</p>
      }
    } @else {
      <p class="note">
        {{
          kind() === 'plant'
            ? 'Photograph the leaves, and any berries or flowers, in good light.'
            : 'Photograph the track from straight above, with a coin or your hand next to it for scale.'
        }}
      </p>
    }

    @if (error()) {
      <p class="note error" role="alert">{{ error() }}</p>
    }

    @if (result(); as r) {
      <section class="result" aria-live="polite">
        <p class="summary">{{ r.summary }}</p>
        <span class="chip" [class]="'chip ' + r.confidence">{{ r.confidence }} confidence</span>

        @if (r.safety_warning) {
          <div class="warning"><b>Safety</b> {{ r.safety_warning }}</div>
        }

        @for (c of r.candidates; track c.common_name + c.scientific_name) {
          <article>
            <h4>
              {{ c.common_name }}
              <span class="likelihood">{{ c.likelihood }}</span>
            </h4>
            @if (c.scientific_name) {
              <div class="latin">{{ c.scientific_name }}</div>
            }
            @if (edibility(c.edibility); as e) {
              <div class="badge" [class]="'badge ' + e.tone">{{ e.label }}</div>
            }
            <p>{{ c.reasoning }}</p>
            @if (c.dangerous_to_humans) {
              <p><b>Risk to people:</b> {{ c.dangerous_to_humans }}</p>
            }
            @if (c.toxicity) {
              <p><b>Toxicity:</b> {{ c.toxicity }}</p>
            }
            @if (c.medicinal_uses) {
              <p><b>Reported uses:</b> {{ c.medicinal_uses }}</p>
            }
            @if (c.lookalikes) {
              <p><b>Look-alikes:</b> {{ c.lookalikes }}</p>
            }
          </article>
        }

        @if (r.photo_tips) {
          <p class="note"><b>For a better answer:</b> {{ r.photo_tips }}</p>
        }
      </section>
    }

    <p class="disclaimer">
      This is an AI's best guess from one photo and it can be wrong. Never eat anything, or use it as medicine, on the
      strength of this result alone. Photos are sent to Anthropic's Claude for analysis.
    </p>
  `,
  styles: `
    .kinds,
    .pick {
      display: flex;
      gap: 8px;
      padding: 14px 16px 0;
    }
    .kinds button,
    .btn {
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
    .kinds button.sel {
      border-color: var(--primary);
      background: var(--primary-tint);
      color: var(--primary);
      font-weight: 500;
    }
    .btn {
      color: var(--primary);
      font-weight: 500;
    }
    .btn:hover {
      background: var(--hover);
    }
    .btn:focus-within {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
    .btn input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .preview {
      display: block;
      width: calc(100% - 32px);
      max-height: 240px;
      margin: 14px 16px 0;
      border-radius: 12px;
      object-fit: cover;
    }
    .check {
      display: flex;
      gap: 10px;
      padding: 12px 20px 0;
      font-size: 14px;
      line-height: 1.35;
      cursor: pointer;
    }
    .check small {
      display: block;
      color: var(--text-2);
      font-size: 12px;
    }
    .go {
      display: block;
      width: calc(100% - 32px);
      height: 42px;
      margin: 14px 16px 0;
      border: 0;
      border-radius: 21px;
      background: var(--primary);
      color: #fff;
      font: inherit;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
    }
    .go:hover:not(:disabled) {
      background: var(--primary-dark);
    }
    .go:disabled {
      opacity: 0.7;
      cursor: progress;
    }
    .note {
      margin: 12px 20px 0;
      color: var(--text-2);
      font-size: 13px;
      line-height: 1.45;
    }
    .note.error {
      color: #d93025;
    }
    .result {
      margin-top: 16px;
      padding: 14px 20px 0;
      border-top: 1px solid var(--border);
    }
    .result .note {
      margin: 12px 0 0;
    }
    .summary {
      margin: 0 0 8px;
      font-size: 16px;
      line-height: 1.4;
    }
    .chip {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      background: var(--surface);
      color: var(--text-2);
      font-size: 12px;
      text-transform: capitalize;
    }
    .chip.high {
      background: #e6f4ea;
      color: #137333;
    }
    .chip.low {
      background: #fce8e6;
      color: #c5221f;
    }
    .warning {
      margin-top: 12px;
      padding: 10px 12px;
      border-left: 4px solid #d93025;
      border-radius: 4px;
      background: #fce8e6;
      color: #5f2120;
      font-size: 14px;
      line-height: 1.45;
    }
    article {
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      font-size: 14px;
      line-height: 1.45;
    }
    h4 {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      margin: 0;
      font-size: 16px;
      font-weight: 500;
    }
    .likelihood {
      flex: none;
      color: var(--text-2);
      font-size: 12px;
      font-weight: 400;
      text-transform: capitalize;
    }
    .latin {
      color: var(--text-2);
      font-style: italic;
    }
    .badge {
      display: inline-block;
      margin-top: 6px;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge.good {
      background: #e6f4ea;
      color: #137333;
    }
    .badge.warn {
      background: #fef7e0;
      color: #8a5a00;
    }
    .badge.bad {
      background: #d93025;
      color: #fff;
    }
    .badge.neutral {
      background: var(--surface);
      color: var(--text-2);
    }
    article p {
      margin: 6px 0 0;
    }
    .disclaimer {
      margin: 18px 20px 20px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
      color: var(--text-2);
      font-size: 12px;
      line-height: 1.45;
    }
  `,
})
export class IdentifyComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  protected readonly maps = inject(MapService);

  protected readonly kind = signal<IdentifyKind>('plant');
  protected readonly preview = signal('');
  protected readonly useLocation = signal(true);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly result = signal<IdentifyResult | null>(null);

  private file?: File;
  private requestId = 0;

  ngOnDestroy() {
    this.releasePreview();
  }

  protected edibility(value: Edibility) {
    return EDIBILITY[value];
  }

  protected setKind(kind: IdentifyKind) {
    this.kind.set(kind);
    this.result.set(null);
    this.error.set('');
  }

  protected onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // so picking the same photo again still fires a change
    if (!file) return;
    this.releasePreview();
    this.file = file;
    this.preview.set(URL.createObjectURL(file));
    this.result.set(null);
    this.error.set('');
    this.requestId++;
    this.loading.set(false);
  }

  protected async identify() {
    if (!this.file) return;
    const id = ++this.requestId;
    this.loading.set(true);
    this.error.set('');
    this.result.set(null);

    const body = new FormData();
    body.append('image', await shrink(this.file), 'photo.jpg');
    body.append('kind', this.kind());
    const here = this.maps.userLocation();
    if (here && this.useLocation()) {
      body.append('lat', String(here.lat));
      body.append('lng', String(here.lng));
    }

    try {
      const result = await firstValueFrom(this.http.post<IdentifyResult>(`${API_BASE}/identify/`, body));
      if (id === this.requestId) this.result.set(result);
    } catch (e) {
      if (id !== this.requestId) return;
      const detail = e instanceof HttpErrorResponse ? e.error?.detail : null;
      this.error.set(
        typeof detail === 'string'
          ? detail
          : "Couldn't reach the Arsenal backend to identify this photo. Check that it is running.",
      );
    } finally {
      if (id === this.requestId) this.loading.set(false);
    }
  }

  private releasePreview() {
    if (this.preview()) URL.revokeObjectURL(this.preview());
  }
}

/** Scales a photo down to a JPEG the server accepts. Falls back to the original if the browser cannot decode it. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode failed'))), 'image/jpeg', 0.85),
    );
  } catch {
    return file;
  }
}
