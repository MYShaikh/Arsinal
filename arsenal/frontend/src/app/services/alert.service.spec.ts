import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { bearingDeg, compass, distanceMetres, formatDistance } from '../geo';
import { NuclearPlant } from '../models';
import { AlertService } from './alert.service';
import { LayersService } from './layers.service';
import { MapService } from './map.service';

describe('AlertService', () => {
  // At this latitude 0.0005 degrees of latitude is about 56 m, 0.001 about 111 m and 0.0015 about 167 m.
  const plant: NuclearPlant = { id: 'way/1', name: 'Test Plant', operator: '', capacity_mw: 1000, lat: 10, lng: 20 };

  let alerts: AlertService;
  let maps: MapService;

  const standAt = (lat: number) => {
    maps.userLocation.set({ lat, lng: 20 });
    TestBed.tick();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    alerts = TestBed.inject(AlertService);
    maps = TestBed.inject(MapService);
    TestBed.inject(LayersService).plants.set([plant]);
  });

  it('is quiet outside 100 m and alerts inside it', () => {
    standAt(10.0015);
    expect(alerts.active()).toBeNull();

    standAt(10.0005);
    expect(alerts.active()?.plant.name).toBe('Test Plant');
    expect(alerts.active()?.distance).toBeGreaterThan(50);
    expect(alerts.active()?.distance).toBeLessThan(62);
  });

  it('keeps the alert until the user is clearly out, then alerts again on re-entry', () => {
    standAt(10.0005);
    alerts.dismiss();

    standAt(10.001); // 111 m: past 100 m but inside the 120 m exit margin
    expect(alerts.active()).not.toBeNull();
    expect(alerts.dismissed()).toBe(true);

    standAt(10.0015);
    expect(alerts.active()).toBeNull();

    standAt(10.0005);
    expect(alerts.active()).not.toBeNull();
    expect(alerts.dismissed()).toBe(false);
  });

  it('clears when the position is lost', () => {
    standAt(10.0005);
    maps.userLocation.set(null);
    TestBed.tick();
    expect(alerts.active()).toBeNull();
  });
});

describe('geo helpers', () => {
  it('measures distance and bearing', () => {
    const origin = { lat: 0, lng: 0 };
    expect(distanceMetres(origin, { lat: 0.01, lng: 0 })).toBeCloseTo(1112, -1);
    expect(bearingDeg(origin, { lat: 0.01, lng: 0 })).toBeCloseTo(0);
    expect(bearingDeg(origin, { lat: 0, lng: 0.01 })).toBeCloseTo(90);
    expect(bearingDeg(origin, { lat: -0.01, lng: 0 })).toBeCloseTo(180);
  });

  it('names compass points and formats distances', () => {
    expect(compass(0)).toBe('N');
    expect(compass(293)).toBe('NW');
    expect(compass(350)).toBe('N');
    expect(formatDistance(60)).toBe('60 m (197 ft)');
    expect(formatDistance(590)).toBe('590 m (0.4 mi)');
    expect(formatDistance(2500)).toBe('2.5 km (1.6 mi)');
  });
});
