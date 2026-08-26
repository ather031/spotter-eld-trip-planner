# Spotter ELD Trip Planner

Django + React take-home: HOS-compliant trip plans with route map, stops, and paper-style daily ELD logs.

> **Status:** Live at [https://assessment.vehicledailycheck.com](https://assessment.vehicledailycheck.com) · Phase 5 done

## Hosting recommendation (your VDC server)

Using your existing [Vehicle Daily Check](https://vehicledailycheck.com/) infrastructure is fine for this assessment — and usually smarter than burning hours on a new PaaS.

**Recommended URL:** `https://assessment.vehicledailycheck.com`

Keep it **isolated** from VDC:

| Piece | Rule |
|-------|------|
| Subdomain | Dedicated (`assessment.…`), not inside the VDC app |
| Django process | Separate gunicorn/systemd unit |
| Database | Separate Postgres DB (`spotter_eld`) — never VDC’s DB |
| Env / secrets | Separate `.env` |
| Code | This repo only |

### Phase 5 — go live (Vultr)

**Live URL:** https://assessment.vehicledailycheck.com  

Full runbook: [`docs/deploy/assessment-vehicledailycheck.md`](docs/deploy/assessment-vehicledailycheck.md)

| Piece | Value |
|-------|--------|
| gunicorn | `127.0.0.1:8001` (VDC keeps `8000`) |
| DB | `spotter_eld` |
| Code | `/var/www/spotter-eld/` |
| systemd | `spotter-eld-api.service` (`www-data`) |
| Redeploy | `cd /var/www/spotter-eld/repo && sudo bash scripts/deploy-spotter-eld.sh` |

Frontend production uses **same-origin** `/api` (empty `VITE_API_BASE_URL`).

Loom note: *“Dedicated subdomain on my VPS, isolated from Vehicle Daily Check.”*

The brief suggests Vercel/Railway — that is a **suggestion**. A clean HTTPS demo URL matters more.

## Database name (create this)

```text
spotter_eld
```

### Local Postgres (Windows / psql)

```sql
CREATE DATABASE spotter_eld;
-- optional dedicated role:
-- CREATE USER spotter_eld WITH PASSWORD 'your_password';
-- GRANT ALL PRIVILEGES ON DATABASE spotter_eld TO spotter_eld;
```

Or CLI:

```bash
createdb spotter_eld
```

Default local connection (override in `backend/.env`):

| Var | Default |
|-----|---------|
| `POSTGRES_DB` | `spotter_eld` |
| `POSTGRES_USER` | `postgres` |
| `POSTGRES_PASSWORD` | `postgres` |
| `POSTGRES_HOST` | `127.0.0.1` |
| `POSTGRES_PORT` | `5432` |

You can also set `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/spotter_eld`.

> The API is mostly **stateless** (no trip persistence yet). Postgres still runs Django’s system tables and matches production. Do **not** use SQLite.

## Quick start

### Backend

```powershell
# 1) Create DB spotter_eld (see above)
# 2) Copy env
copy backend\.env.example backend\.env
# edit POSTGRES_PASSWORD if needed

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

Open http://127.0.0.1:5173 — Vite proxies `/api` → Django `:8000`.

## Architecture

```
backend/hos/           Pure-Python HOS scheduler (unit-tested)
backend/trips/         DRF API + Nominatim/Photon + OSRM
frontend/              React + Vite + TS + Tailwind + Leaflet
  components/EldLogSheet.tsx   Paper-style FMCSA daily grids (SVG)
```

`POST /api/trips/plan/` → geocode → route → HOS plan → JSON.

## Daily log sheets

- Classic 4-row graph: Off Duty / Sleeper / Driving / On Duty (Not Driving)
- Multi-day → one sheet per calendar day; gaps filled as Off Duty → **24:00** totals

## HOS assumptions

Property-carrying, **70 hrs / 8 days**: 11h drive, 14h window, 30-min after 8h drive, 10h reset, 34h restart, fuel every 1,000 mi, 1h on-duty pickup & dropoff.

## Demo presets (in UI)

| Preset | Route | Cycle |
|--------|-------|-------|
| Short same-day | Chicago → Indy → Cincinnati | 12 h |
| Multi-day haul | Chicago → Denver → LA | 5 h |
| High cycle used | Chicago → Indy → Cincinnati | 68 h |

## Out of scope

No auth product features, VDC coupling, paid map APIs, or ELD hardware.
