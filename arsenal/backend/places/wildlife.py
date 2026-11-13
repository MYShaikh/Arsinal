"""Dangerous, venomous and poisonous animals near a point, with a picture of each taken from Wikipedia."""
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote

import requests
from django.core.cache import cache

from .identify import generate_json

CACHE_SECONDS = 24 * 3600
WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/'
# Wikipedia asks API clients to identify themselves.
HEADERS = {'User-Agent': 'Arsenal/1.0 (local wildlife safety lookup)'}

SYSTEM_PROMPT = """\
You are the wildlife safety feature of Arsenal, an outdoor map app. Given an approximate location, list the animals \
that live there (or could be met there) which can hurt a person, so that someone about to go outdoors knows what to \
watch for. Only list animals whose range really includes the location; do not pad the list with famous animals from \
other continents.

Return 8 to 14 animals, most dangerous first, and include a mix across the categories that apply to the region:
- "dangerous": can injure or kill by attacking, biting or crushing (large predators, crocodilians, large mammals, \
sharks if the location is on a coast).
- "venomous": injects venom by bite or sting (snakes, spiders, scorpions, some fish, stinging insects).
- "poisonous": harmful to touch or eat (some toads, frogs, newts, caterpillars, pufferfish).

For each animal give the common name, the scientific name, a short plain description of how it can hurt a person and \
the symptoms, and what to do to avoid it and what to do if hurt. For wikipedia_title give the exact title of its \
English Wikipedia article (for example "Eastern diamondback rattlesnake"). Be plain and brief: every field is shown \
on a phone screen. Do not invent animals; if you are unsure the species lives there, leave it out."""

_ANIMAL = {
    'type': 'object',
    'properties': {
        'common_name': {'type': 'string'},
        'scientific_name': {'type': 'string'},
        'category': {'type': 'string', 'enum': ['dangerous', 'venomous', 'poisonous']},
        'risk': {'type': 'string', 'description': 'How it can hurt a person, and the symptoms.'},
        'precaution': {'type': 'string', 'description': 'How to avoid it, and what to do if hurt.'},
        'wikipedia_title': {'type': 'string'},
    },
    'required': ['common_name', 'scientific_name', 'category', 'risk', 'precaution', 'wikipedia_title'],
}

SCHEMA = {
    'type': 'object',
    'properties': {
        'region': {'type': 'string', 'description': 'The region the list is for, e.g. "Georgia, United States".'},
        'animals': {'type': 'array', 'items': _ANIMAL},
    },
    'required': ['region', 'animals'],
}


def _picture(title):
    """(image_url, page_url) of an English Wikipedia article, or (None, None) if there is none."""
    try:
        reply = requests.get(WIKI_SUMMARY + quote(title.replace(' ', '_'), safe=''), headers=HEADERS, timeout=10,
                          allow_redirects=True)
        if reply.status_code != 200:
            return None, None
        data = reply.json()
        image = (data.get('thumbnail') or {}).get('source')
        page = (data.get('content_urls') or {}).get('desktop', {}).get('page')
        return image, page
    except (requests.RequestException, ValueError):
        return None, None


def _with_picture(animal):
    # The model's article title is usually right; the scientific name is the fallback.
    image, page = _picture(animal['wikipedia_title'])
    if not image and animal['scientific_name']:
        image, page = _picture(animal['scientific_name'])
    return {**animal, 'image_url': image, 'page_url': page}


def nearby(lat, lng):
    """Dangerous animals near (lat, lng) with pictures. Raises IdentifyError if Gemini cannot answer."""
    # Rounded to 0.5 degrees (about 50 km): the same answer is shared by everyone in the area, and cached.
    lat, lng = round(lat * 2) / 2, round(lng * 2) / 2
    key = f'wildlife:{lat}:{lng}'
    cached = cache.get(key)
    if cached:
        return cached

    question = f'The location is near latitude {lat}, longitude {lng}. Which animals there can hurt a person?'
    answer = generate_json(SYSTEM_PROMPT, [question], SCHEMA)
    with ThreadPoolExecutor(max_workers=6) as pool:
        animals = list(pool.map(_with_picture, answer['animals']))
    result = {'region': answer['region'], 'animals': animals}
    cache.set(key, result, CACHE_SECONDS)
    return result
