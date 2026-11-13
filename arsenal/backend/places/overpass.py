"""Thin client for the OpenStreetMap Overpass API (data licensed ODbL, https://www.openstreetmap.org/copyright)."""
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

# Free public instances, which are often busy. For heavy use run your own and put it first.
ENDPOINTS = (
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
)
USER_AGENT = 'arsenal-app/1.0'
COOL_DOWN_SECONDS = 60

_down_until = {}
_lock = threading.Lock()


class OverpassError(Exception):
    """No Overpass instance could answer the query."""


def _order():
    """Healthy instances first, in preference order; ones that failed recently go last."""
    now = time.monotonic()
    with _lock:
        healthy = [u for u in ENDPOINTS if _down_until.get(u, 0) <= now]
    return healthy + [u for u in ENDPOINTS if u not in healthy]


def run(query, timeout=30):
    body = urllib.parse.urlencode({'data': query}).encode()
    last_error = None
    for url in _order():
        request = urllib.request.Request(url, data=body, headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
            last_error = error
            with _lock:
                _down_until[url] = time.monotonic() + COOL_DOWN_SECONDS
    raise OverpassError(str(last_error))
