"""Hospitals, pharmacies, grocery stores and ammunition shops from OpenStreetMap, served in map tiles."""
import math
import threading
import time

from . import overpass

TILE_ZOOM = 12
CACHE_TTL_SECONDS = 6 * 3600
MAX_CACHED_TILES = 400

_cache = {}
_lock = threading.Lock()


def tile_bounds(x, y, zoom=TILE_ZOOM):
    """South, west, north, east of a slippy-map tile."""
    n = 2**zoom
    lat = lambda row: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))
    return lat(y + 1), x / n * 360 - 180, lat(y), (x + 1) / n * 360 - 180


def classify(tags):
    if tags.get('amenity') == 'hospital' or tags.get('healthcare') == 'hospital':
        return 'hospital'
    if tags.get('amenity') == 'pharmacy' or tags.get('healthcare') == 'pharmacy':
        return 'pharmacy'
    if tags.get('shop') in ('supermarket', 'grocery'):
        return 'grocery'
    if tags.get('shop') == 'weapons':
        return 'ammo'  # OSM's tag for gun and ammunition shops
    return None


def parse_elements(elements):
    places = []
    for el in elements:
        tags = el.get('tags', {})
        point = el if 'lat' in el else el.get('center')
        category = classify(tags)
        if not point or not category:
            continue
        places.append({
            'id': f"{el['type']}/{el['id']}",
            'category': category,
            'name': tags.get('name') or tags.get('name:en') or '',
            'lat': round(point['lat'], 5),
            'lng': round(point['lon'], 5),
        })
    return places


def _query(south, west, north, east):
    box = f'({south:.5f},{west:.5f},{north:.5f},{east:.5f})'
    return (
        '[out:json][timeout:25];('
        f'nwr["amenity"="hospital"]{box};nwr["healthcare"="hospital"]{box};'
        f'nwr["amenity"="pharmacy"]{box};nwr["healthcare"="pharmacy"]{box};'
        f'nwr["shop"~"^(supermarket|grocery)$"]{box};'
        f'nwr["shop"="weapons"]{box};'
        ');out center tags;'
    )


def fetch_tile(x, y):
    """Every place of the four categories inside one tile. Cached, since OSM data changes slowly."""
    key = (x, y)
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]

    places = parse_elements(overpass.run(_query(*tile_bounds(x, y)))['elements'])

    with _lock:
        if len(_cache) >= MAX_CACHED_TILES:
            _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
        _cache[key] = (now, places)
    return places
