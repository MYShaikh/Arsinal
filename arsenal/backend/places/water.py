"""Nearest flowing water (rivers, streams and canals) to a point, from OpenStreetMap."""
import math
import threading
import time

from . import overpass
from .geo import bearing_deg, haversine_m

# Search outwards so a nearby stream is found quickly and a remote area still gets an answer.
SEARCH_RADII_M = (1500, 6000, 25000, 80000)
CACHE_TTL_SECONDS = 3600

_cache = {}
_lock = threading.Lock()


def closest_point_on_line(lat, lng, geometry):
    """Nearest point to (lat, lng) on a polyline of {'lat', 'lon'} nodes, or None for an empty line."""
    metres_per_deg_lat = 110540.0
    metres_per_deg_lng = 111320.0 * math.cos(math.radians(lat))
    to_xy = lambda p: ((p['lon'] - lng) * metres_per_deg_lng, (p['lat'] - lat) * metres_per_deg_lat)

    best = None
    segments = list(zip(geometry, geometry[1:])) or [(node, node) for node in geometry[:1]]
    for a, b in segments:
        (ax, ay), (bx, by) = to_xy(a), to_xy(b)
        dx, dy = bx - ax, by - ay
        length_sq = dx * dx + dy * dy
        t = 0 if length_sq == 0 else max(0, min(1, -(ax * dx + ay * dy) / length_sq))
        px, py = ax + t * dx, ay + t * dy
        dist_sq = px * px + py * py
        if best is None or dist_sq < best[0]:
            best = (dist_sq, lat + py / metres_per_deg_lat, lng + px / metres_per_deg_lng)
    return best and (best[1], best[2])


def nearest_in(elements, lat, lng):
    best = None
    for el in elements:
        point = closest_point_on_line(lat, lng, el.get('geometry', []))
        if not point:
            continue
        distance = haversine_m(lat, lng, *point)
        if best is None or distance < best['distance_m']:
            tags = el.get('tags', {})
            best = {
                'found': True,
                'category': 'water',
                'lat': round(point[0], 5),
                'lng': round(point[1], 5),
                'name': tags.get('name') or tags.get('name:en') or '',
                'kind': tags.get('waterway', 'river'),
                'distance_m': round(distance),
                'bearing_deg': round(bearing_deg(lat, lng, *point)),
            }
    return best


def nearest_flowing_water(lat, lng):
    key = (round(lat, 3), round(lng, 3))  # about 100 m, so a moving user does not trigger a query per step
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]

    result = {'found': False}
    for index, radius in enumerate(SEARCH_RADII_M):
        query = (
            f'[out:json][timeout:25];way(around:{radius},{lat:.5f},{lng:.5f})'
            '["waterway"~"^(river|stream|canal)$"];out geom;'
        )
        try:
            found = nearest_in(overpass.run(query)['elements'], lat, lng)
        except overpass.OverpassError:
            if index == 0:
                raise
            # The wide searches are the slow ones. Report what was ruled out instead of failing, and do not cache it.
            return {'found': False, 'searched_m': SEARCH_RADII_M[index - 1], 'incomplete': True}
        if found:
            result = found
            break
    else:
        result = {'found': False, 'searched_m': SEARCH_RADII_M[-1]}

    with _lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (now, result)
    return result
