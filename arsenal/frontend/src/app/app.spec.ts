import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { App } from './app';
import { MapService } from './services/map.service';
import { PlacesStore } from './services/places.store';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

describe('Arsenal', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('renders the Arsenal shell', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Arsenal');
    expect(el.querySelector('app-map')).toBeTruthy();
  });

  it('asks the user to add a key when Django has none', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    http.match((r) => r.url.endsWith('/places/') || r.url.endsWith('/recents/')).forEach((r) => r.flush([]));
    http.expectOne((r) => r.url.endsWith('/config/')).flush({ googleMapsApiKey: '' });
    await settle();
    fixture.detectChanges();
    expect(TestBed.inject(MapService).status()).toBe('no-key');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Add your Google Maps API key');
  });

  it('reports when the Django API is unreachable', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    http.match((r) => r.url.endsWith('/places/') || r.url.endsWith('/recents/')).forEach((r) =>
      r.error(new ProgressEvent('error')),
    );
    http.expectOne((r) => r.url.endsWith('/config/')).error(new ProgressEvent('error'));
    await settle();
    expect(TestBed.inject(MapService).status()).toBe('api-down');
    expect(TestBed.inject(PlacesStore).offline()).toBe(true);
  });
});

describe('PlacesStore', () => {
  it('matches saved places by Google place id or coordinates', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const store = TestBed.inject(PlacesStore);
    store.saved.set([
      { id: 1, name: 'A', address: '', lat: 1, lng: 2, google_place_id: 'p1', category: 'favorite', note: '', created_at: '' },
    ]);
    expect(store.savedMatch({ name: 'x', address: '', lat: 9, lng: 9, placeId: 'p1' })?.id).toBe(1);
    expect(store.savedMatch({ name: 'x', address: '', lat: 1, lng: 2 })?.id).toBe(1);
    expect(store.savedMatch({ name: 'x', address: '', lat: 5, lng: 5, placeId: 'other' })).toBeUndefined();
  });
});

describe('Live location', () => {
  let onPosition: PositionCallback;
  const clearWatch = vi.fn();

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (success: PositionCallback) => {
          onPosition = success;
          return 7;
        },
        clearWatch,
      },
    });
  });

  const fix = (lat: number, lng: number) =>
    onPosition({ coords: { latitude: lat, longitude: lng, accuracy: 10 } } as GeolocationPosition);

  it('tracks position updates, then stops on the next press while following', () => {
    const maps = TestBed.inject(MapService);
    maps.locateMe();
    expect(maps.locating()).toBe(true);

    fix(1, 2);
    expect(maps.tracking()).toBe(true);
    expect(maps.following()).toBe(true);
    expect(maps.userLocation()).toEqual({ lat: 1, lng: 2 });

    fix(3, 4);
    expect(maps.userLocation()).toEqual({ lat: 3, lng: 4 });

    maps.locateMe();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(maps.tracking()).toBe(false);
  });

  it('re-centres instead of stopping when the user has panned away', () => {
    const maps = TestBed.inject(MapService);
    maps.locateMe();
    fix(1, 2);
    maps.following.set(false); // what dragging the map does

    maps.locateMe();
    expect(maps.tracking()).toBe(true);
    expect(maps.following()).toBe(true);
  });
});
