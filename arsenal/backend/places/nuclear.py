"""Nuclear power plant data, sourced from OpenStreetMap (ODbL, https://www.openstreetmap.org/copyright)."""
import json
import re
import urllib.parse
import urllib.request
from functools import lru_cache
from pathlib import Path

SNAPSHOT = Path(__file__).parent / 'data' / 'nuclear_plants.json'
OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
OVERPASS_QUERY = (
    '[out:json][timeout:120];'
    '(nwr["power"="plant"]["plant:source"="nuclear"];'
    'nwr["power"="plant"]["generator:source"="nuclear"];);'
    'out center tags;'
)

# Research reactors and production sites that OSM tags as power plants.
_NOT_POWER_PLANT = re.compile(r'science center|estudios nucleares|research|experiment|実験|실험|plutonium production|dismantled', re.I)

_UNIT_TO_MW = {'w': 1e-6, 'kw': 1e-3, 'mw': 1, 'gw': 1e3}


def parse_capacity_mw(raw):
    """Turn an OSM output value such as '1.2 GW', '900 MW' or '1200000000' into megawatts."""
    match = re.match(r'^\s*([\d.,]+)\s*([a-zA-Z]*)\s*$', raw or '')
    if not match:
        return None
    try:
        number = float(match.group(1).replace(',', '.') if match.group(1).count(',') == 1 else match.group(1).replace(',', ''))
    except ValueError:
        return None
    unit = match.group(2).lower()
    if unit:
        factor = _UNIT_TO_MW.get(unit)
        return round(number * factor) if factor else None
    return round(number / 1e6) if number >= 1e5 else round(number)  # bare numbers are watts or megawatts


def parse_elements(elements):
    """Convert Overpass elements to plants. Entries with no output tag, or a research-site name, are skipped."""
    plants = []
    for el in elements:
        tags = el.get('tags', {})
        point = el if 'lat' in el else el.get('center')
        output = tags.get('plant:output:electricity')
        name = tags.get('name') or tags.get('name:en') or ''
        # "yes" means it generates electricity but no figure was recorded.
        if not point or not output or output == 'no' or _NOT_POWER_PLANT.search(name):
            continue
        capacity = parse_capacity_mw(output)
        plants.append({
            'id': f"{el['type']}/{el['id']}",
            'name': name or 'Nuclear power plant',
            'operator': tags.get('operator', ''),
            'capacity_mw': capacity,
            'lat': round(point['lat'], 5),
            'lng': round(point['lon'], 5),
        })
    return sorted(plants, key=lambda p: p['name'])


def fetch_plants():
    body = urllib.parse.urlencode({'data': OVERPASS_QUERY}).encode()
    request = urllib.request.Request(OVERPASS_URL, data=body, headers={'User-Agent': 'arsenal-app/1.0'})
    with urllib.request.urlopen(request, timeout=180) as response:
        return parse_elements(json.load(response)['elements'])


@lru_cache(maxsize=1)
def load_snapshot():
    return json.loads(SNAPSHOT.read_text(encoding='utf-8'))
