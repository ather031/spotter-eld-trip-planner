# Deploy Spotter ELD → https://assessment.vehicledailycheck.com

Isolated assessment app on the same Vultr VPS as Vehicle Daily Check.

| Piece | Spotter | Do **not** use |
|-------|---------|----------------|
| URL | `assessment.vehicledailycheck.com` | VDC apex / `app.` for this app |
| Code | `/var/www/spotter-eld/` | `/var/www/vehicledailycheck/` |
| DB | `spotter_eld` | VDC database |
| Env | `/var/www/spotter-eld/api/.env` | VDC `.env` |
| systemd | `spotter-eld-api.service` | `vehicledailycheck-api.service` |
| gunicorn | `127.0.0.1:8001` | `127.0.0.1:8000` (VDC) |
| nginx | `assessment.vehicledailycheck.com.conf` | VDC site configs |

WSGI module: `config.wsgi:application`  
Frontend prod: relative `/api` (empty `VITE_API_BASE_URL`).

---

## Safety checklist (before every command)

- [ ] Port **8001** only for Spotter
- [ ] DB name **`spotter_eld`**
- [ ] Paths only under **`/var/www/spotter-eld`**
- [ ] Do **not** stop/restart `vehicledailycheck-api`
- [ ] Do **not** edit VDC `.env` or VDC nginx

---

## A) DNS (Hostinger)

1. Add **A** record: host `assessment` → same Vultr IP as `vehicledailycheck.com` (`78.141.194.242`).
2. Wait for propagation:

```bash
dig +short assessment.vehicledailycheck.com
# expect: 78.141.194.242
```

---

## B) Postgres (on VPS) — you already created the DB

```bash
sudo -u postgres psql -c "CREATE DATABASE spotter_eld;"
```

Recommended dedicated role (do this next if you haven’t):

```bash
sudo -u postgres psql <<'SQL'
CREATE USER spotter_eld WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE spotter_eld TO spotter_eld;
\c spotter_eld
GRANT ALL ON SCHEMA public TO spotter_eld;
ALTER SCHEMA public OWNER TO spotter_eld;
SQL
```

If the role already exists, skip `CREATE USER` and only run the `GRANT` / schema lines (and `ALTER USER spotter_eld WITH PASSWORD '...'` if needed).

---

## C) Directories + clone

```bash
sudo mkdir -p /var/www/spotter-eld /var/log/spotter-eld /var/www/certbot
sudo chown -R deploy:deploy /var/www/spotter-eld
sudo chown -R www-data:www-data /var/log/spotter-eld

sudo -u deploy git clone https://github.com/ather031/spotter-eld-trip-planner.git /var/www/spotter-eld/repo
```

---

## D) Python venv + `.env` + first migrate

```bash
sudo mkdir -p /var/www/spotter-eld/api
sudo -u deploy python3 -m venv /var/www/spotter-eld/api/.venv

# Sync backend once (or wait for deploy script)
sudo -u deploy rsync -a --delete \
  --exclude '.venv' --exclude '.env' --exclude '__pycache__' --exclude 'staticfiles' \
  /var/www/spotter-eld/repo/backend/ /var/www/spotter-eld/api/

sudo -u deploy cp /var/www/spotter-eld/repo/deploy/env.production.example /var/www/spotter-eld/api/.env
sudo -u deploy nano /var/www/spotter-eld/api/.env
# Set DJANGO_SECRET_KEY, DATABASE_URL (or POSTGRES_*), hosts already filled for assessment.*
```

Generate a secret:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Then:

```bash
cd /var/www/spotter-eld/api
sudo -u deploy bash -lc 'source .venv/bin/activate && pip install -r requirements.txt && python manage.py migrate --noinput'

sudo chown www-data:www-data /var/www/spotter-eld/api/.env
sudo chmod 600 /var/www/spotter-eld/api/.env
```

---

## E) Install systemd + nginx

```bash
sudo cp /var/www/spotter-eld/repo/deploy/systemd/spotter-eld-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spotter-eld-api

sudo cp /var/www/spotter-eld/repo/deploy/nginx/assessment.vehicledailycheck.com.conf \
  /etc/nginx/sites-available/assessment.vehicledailycheck.com.conf
sudo ln -sf /etc/nginx/sites-available/assessment.vehicledailycheck.com.conf \
  /etc/nginx/sites-enabled/assessment.vehicledailycheck.com.conf

sudo nginx -t && sudo systemctl reload nginx
```

Check API locally (does not touch VDC):

```bash
curl -fsS http://127.0.0.1:8001/api/health/
# {"status":"ok",...}
```

---

## F) TLS

DNS must already point here.

```bash
sudo certbot --nginx -d assessment.vehicledailycheck.com
```

---

## G) Build + full deploy

```bash
cd /var/www/spotter-eld/repo
sudo bash scripts/deploy-spotter-eld.sh
```

This pulls latest `main`, syncs API, migrates, builds frontend to `/var/www/spotter-eld/web`, chowns for `www-data`, restarts **only** `spotter-eld-api`, reloads nginx.

---

## H) Verify

```bash
sudo systemctl status spotter-eld-api --no-pager
curl -I https://assessment.vehicledailycheck.com
curl -fsS https://assessment.vehicledailycheck.com/api/health/

curl -fsS -X POST https://assessment.vehicledailycheck.com/api/trips/plan/ \
  -H 'Content-Type: application/json' \
  -d '{
    "current_location": "Chicago, IL",
    "pickup_location": "Indianapolis, IN",
    "dropoff_location": "Cincinnati, OH",
    "cycle_used_hours": 12,
    "start_hour_of_day": 6
  }' | head -c 500
echo
```

Open the site in a browser and run a demo preset.

---

## Routine redeploy (after you push to GitHub)

```bash
cd /var/www/spotter-eld/repo
sudo bash scripts/deploy-spotter-eld.sh
```

---

## Loom note

> Deployed on a dedicated subdomain (`assessment.vehicledailycheck.com`) on my VPS — isolated process, database, and nginx site from Vehicle Daily Check.

---

## Manual vs in-repo

| You (SSH / Hostinger) | In this repo |
|-----------------------|--------------|
| DNS A record | `deploy/nginx/...` |
| `CREATE DATABASE` / role | `deploy/env.production.example` |
| Clone, fill `.env`, certbot | `scripts/deploy-spotter-eld.sh` |
| Run deploy script | `docs/deploy/assessment-vehicledailycheck.md` |
