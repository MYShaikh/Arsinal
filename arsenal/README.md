# Arsenal

A Google Maps style web app: an Angular frontend that renders Google Maps, and a Django REST backend that stores
saved places and recent searches and serves the Maps API key to the frontend.

```
arsenal/
  backend/    Django + Django REST Framework (SQLite)
  frontend/   Angular 21 (standalone components, signals)
```

## Features

- Only nuclear power plants are marked: Google's restaurant, shop and hotel icons are hidden, and each of the 209
  plants is a red dot with a translucent 100 m red circle (data from OpenStreetMap, served by Django at `/api/nuclear/`;
  refresh with `manage.py update_nuclear_plants`)
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

Backend environment variables: `GOOGLE_MAPS_API_KEY`, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG` (`1` by default; set `0` in
production), `DJANGO_ALLOWED_HOSTS`, `ARSENAL_FRONTEND_ORIGINS` (CORS origins, comma separated).

The API has no authentication, so all visitors share one set of saved places. Add login before exposing it publicly.
