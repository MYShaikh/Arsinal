import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE } from '../config';
import { Category, PlaceInfo, RecentSearch, SavedPlace } from '../models';
import { ToastService } from './toast.service';

/** Client for the Django API: saved places and recent searches. */
@Injectable({ providedIn: 'root' })
export class PlacesStore {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  readonly saved = signal<SavedPlace[]>([]);
  readonly recents = signal<RecentSearch[]>([]);
  /** True when the Django API could not be reached. */
  readonly offline = signal(false);

  async load() {
    try {
      const [saved, recents] = await Promise.all([
        firstValueFrom(this.http.get<SavedPlace[]>(`${API_BASE}/places/`)),
        firstValueFrom(this.http.get<RecentSearch[]>(`${API_BASE}/recents/`)),
      ]);
      this.saved.set(saved);
      this.recents.set(recents);
      this.offline.set(false);
    } catch {
      this.offline.set(true);
    }
  }

  savedMatch(place: PlaceInfo): SavedPlace | undefined {
    return this.saved().find(
      (s) =>
        (!!place.placeId && s.google_place_id === place.placeId) ||
        (Math.abs(s.lat - place.lat) < 1e-6 && Math.abs(s.lng - place.lng) < 1e-6),
    );
  }

  async save(place: PlaceInfo, category: Category = 'favorite') {
    await this.attempt('Could not save this place.', async () => {
      const created = await firstValueFrom(
        this.http.post<SavedPlace>(`${API_BASE}/places/`, {
          name: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          google_place_id: place.placeId ?? '',
          category,
        }),
      );
      this.saved.update((list) => [created, ...list]);
    });
  }

  async setCategory(id: number, category: Category) {
    await this.attempt('Could not update this place.', async () => {
      const updated = await firstValueFrom(this.http.patch<SavedPlace>(`${API_BASE}/places/${id}/`, { category }));
      this.saved.update((list) => list.map((s) => (s.id === id ? updated : s)));
    });
  }

  async remove(id: number) {
    await this.attempt('Could not remove this place.', async () => {
      await firstValueFrom(this.http.delete(`${API_BASE}/places/${id}/`));
      this.saved.update((list) => list.filter((s) => s.id !== id));
    });
  }

  async addRecent(place: PlaceInfo) {
    try {
      await firstValueFrom(
        this.http.post<RecentSearch>(`${API_BASE}/recents/`, {
          query: place.name,
          address: place.address,
          lat: place.lat,
          lng: place.lng,
          google_place_id: place.placeId ?? '',
        }),
      );
      this.recents.set(await firstValueFrom(this.http.get<RecentSearch[]>(`${API_BASE}/recents/`)));
    } catch {
      // Recents are a convenience; a failure here should not interrupt searching.
    }
  }

  async clearRecents() {
    await this.attempt('Could not clear recent searches.', async () => {
      await firstValueFrom(this.http.delete(`${API_BASE}/recents/clear/`));
      this.recents.set([]);
    });
  }

  private async attempt(failure: string, work: () => Promise<void>) {
    try {
      await work();
    } catch {
      this.toast.show(failure);
    }
  }
}
