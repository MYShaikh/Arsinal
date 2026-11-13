# Arsenal

A Google Maps style web app: an Angular frontend that renders Google Maps, and a Django REST backend that stores
saved places and recent searches and serves the Maps API key to the frontend.

```
arsenal/
  backend/    Django + Django REST Framework (SQLite)
  frontend/   Angular 21 (standalone components, signals)
```

## Features

- Google's restaurant, shop and hotel icons are hidden. Arsenal draws only:
  - **Nuclear power plants**: 209 red dots, each with a translucent 100 m red circle (`/api/nuclear/`;
    refresh with `manage.py update_nuclear_plants`)
  - **Hospitals, pharmacies, grocery stores, ammunition shops**: every one mapped in OpenStreetMap, loaded per
    map tile when zoomed in to city level (`/api/poi/<x>/<y>/`)
  - **Nearest flowing water**: an always-on arrow, distance and dashed line to the closest river, stream or canal,
    measured from your live location or the map centre (`/api/water/nearest/`)
  - Each layer has a checkbox at the top right of the map
- **Nearest tab** (sidebar): pick Walk or Drive, then a type (hospital, pharmacy, grocery store, ammunition shop,
  flowing water, nuclear power plant). Arsenal finds the closest one (`/api/nearest/`) and routes to it. If Google
  cannot route (for example the Routes API is not enabled), it draws a straight line with distance and compass direction.
- **Identify tab** (sidebar): take or choose a photo of a plant, berry, fungus or animal track. Django sends it to
  Claude (`/api/identify/`), which returns the likely species with its reasoning and, for plants, edibility,
  toxicity, reported medicinal uses and dangerous look-alikes. Needs `ANTHROPIC_API_KEY` (see below). An AI guess from
  one photo can be wrong: never eat or self-medicate on this result alone.
- **Nuclear plant alert**: a red banner, three beeps and a vibration whenever your position comes within 100 m of a
  plant's mapped centre point. It clears once you are more than 120 m away.
- **Simulate my location**: every place card has a link to pretend you are standing there, for trying the alert and
  the nearest search without travelling. The location button returns to your real position.
- OpenStreetMap data comes through Django from the free public Overpass servers, which are sometimes slow or busy.
  Arsenal tries several, caches answers and retries as you move the map.
- Full-screen Google Map with zoom, "my location", Default / Satellite / Terrain layers and a traffic overlay
- Place search with autocomplete (Places API New), place details (photo, rating, hours, phone, website)
- Click any point of interest or empty spot on the map to inspect it or drop a pin
- Directions for driving, transit, walking and cycling with step-by-step instructions (Routes API)
- Save places as Favorite / Want to go / Starred, stored by Django and drawn as coloured pins
- Recent searches, light and dark themes, responsive layout

## Google Maps API key

Create a key in Google Cloud and enable these APIs on the project (billing must be on):

- Maps JavaScript API
- Places API (New)
- Routes API
- Geocoding API

Restrict the key to your site (HTTP referrers, e.g. `http://localhost:4200/*`), because the browser receives it.

## Anthropic API key (photo identification only)

The Identify tab needs an Anthropic API key from https://console.anthropic.com (API keys). Set it in the backend
terminal before `runserver`, next to the Google key:

```powershell
$env:ANTHROPIC_API_KEY = "your-key"
```

The key stays on the server; the browser never receives it. Each identification is a paid API call. Everything else
in Arsenal works without this key.

## Run it

Backend (http://localhost:8000):

```powershell
cd arsenal/backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python manage.py migrate
$env:GOOGLE_MAPS_API_KEY = "your-key"
.venv\Scripts\python manage.py runserver
```

Frontend (http://localhost:4200):

```powershell
cd arsenal/frontend
npm install
npm start
```

Without a key the app still starts and shows a setup screen instead of the map.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/config/` | Client config (`googleMapsApiKey`) |
| GET, POST | `/api/places/` | List (optional `?category=`) or save a place |
| GET, PATCH, DELETE | `/api/places/<id>/` | Read, update or remove a saved place |
| GET, POST | `/api/recents/` | Recent searches (latest 20) or record one |
| DELETE | `/api/recents/clear/` | Clear recent searches |
| GET | `/api/health/` | Health check |

## Tests

```powershell
cd arsenal/backend;  .venv\Scripts\python manage.py test
cd arsenal/frontend; npm test -- --watch=false
```

## Configuration

Backend environment variables: `GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY` (optional, for the Identify tab), `DJANGO_SECRET_KEY`, `DJANGO_DEBUG` (`1` by default; set `0` in
production), `DJANGO_ALLOWED_HOSTS`, `ARSENAL_FRONTEND_ORIGINS` (CORS origins, comma separated).

The API has no authentication, so all visitors share one set of saved places. Add login before exposing it publicly.
