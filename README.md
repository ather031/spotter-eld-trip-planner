# Spotter ELD Trip Planner

HOS-compliant trip planning for property-carrying drivers: route map, labeled stops, duty timeline, and FMCSA-style daily ELD log sheets.

Stack: Django REST Framework + React (Vite, TypeScript, Tailwind, Leaflet).

## Production

**Demo:** [https://assessment.vehicledailycheck.com](https://assessment.vehicledailycheck.com)

| Component | Configuration |
|-----------|----------------|
| URL | `https://assessment.vehicledailycheck.com` |
| Process | `spotter-eld-api.service` (gunicorn on `127.0.0.1:8001`) |
| Database | Postgres `spotter_eld` |
| Application root | `/var/www/spotter-eld/` |
| Frontend | Same-origin `/api` |

Deploy runbook: [`docs/deploy/assessment-vehicledailycheck.md`](docs/deploy/assessment-vehicledailycheck.md)

```bash
cd /var/www/spotter-eld/repo && sudo bash scripts/deploy-spotter-eld.sh
```

## Local database

**Development-only defaults below.** Production credentials are supplied via environment variables on the server (`/var/www/spotter-eld/api/.env`) and are **not** committed to this repository. `.env` files are gitignored.

Database name: `spotter_eld`

```sql
CREATE DATABASE spotter_eld;
-- optional dedicated role:
-- CREATE USER spotter_eld WITH PASSWORD 'your_password';
-- GRANT ALL PRIVILEGES ON DATABASE spotter_eld TO spotter_eld;
```

```bash
createdb spotter_eld
```

Local connection defaults (override in `backend/.env` — never use these in production):

| Variable | Default |
|----------|---------|
| `POSTGRES_DB` | `spotter_eld` |
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_PASSWORD` | `postgres` |
| `POSTGRES_HOST` | `127.0.0.1` |
| `POSTGRES_PORT` | `5432` |

Alternatively: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/spotter_eld` (local only).

The API does not persist trip plans; Postgres is used for Django system tables and parity with production. Do not use SQLite.

## Quick start

### Backend

```powershell
copy backend\.env.example backend\.env
# create database spotter_eld; set POSTGRES_PASSWORD if needed

py -3.13 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
cd backend
python manage.py migrate
python -m pytest
python manage.py runserver
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
npm test
```

Open http://127.0.0.1:5173. Vite proxies `/api` to Django on port `8000`.

## Architecture

```
backend/hos/           Pure-Python HOS scheduler (unit-tested)
backend/trips/         DRF API, geocoding (Nominatim/Photon), routing (OSRM)
frontend/              React + Vite + TypeScript + Tailwind + Leaflet
  components/EldLogSheet.tsx   Paper-style FMCSA daily grids (SVG)
```

`POST /api/trips/plan/` geocodes locations, builds a route, applies HOS rules, and returns JSON for the map, stops, timeline, and log sheets.

## Daily log sheets

- Four-row duty graph: Off Duty, Sleeper Berth, Driving, On Duty (Not Driving)
- One sheet per calendar day; gaps filled as Off Duty so row totals equal **24:00**

## HOS model

Property-carrying, **70 hours / 8 days**: 11-hour drive limit, 14-hour window, 30-minute break after 8 hours of driving, 10-hour reset, 34-hour restart, fuel stop every 1,000 miles, and one hour on-duty for pickup and dropoff.

## Demo presets

| Preset | Route | Cycle used |
|--------|-------|------------|
| Short same-day | Chicago → Indianapolis → Cincinnati | 12 h |
| Multi-day haul | Chicago → Denver → Los Angeles | 5 h |
| High cycle used | Chicago → Indianapolis → Cincinnati | 68 h |

### Verification checklist

1. **Short same-day** — map and stop pins, duty timeline, one daily log sheet; totals ≈ 24:00.
2. **Multi-day haul** — multiple log sheets; fuel and rest markers on the map and timeline.
3. **High cycle used** — 34-hour restart visible; cycle warning shown in the plan banner.

Log sheets should remain readable on desktop and at mobile widths (horizontal scroll is expected).

## Scope exclusions

Authentication, paid mapping APIs, and ELD hardware connectivity are out of scope.
