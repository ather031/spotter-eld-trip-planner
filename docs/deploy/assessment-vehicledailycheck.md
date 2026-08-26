# Deploy Spotter ELD

**URL:** https://assessment.vehicledailycheck.com

Isolated deployment on the same Vultr VPS as Vehicle Daily Check. Spotter must not share VDC paths, database, environment files, or process units.

| Component | Spotter | Do not use |
|-----------|---------|------------|
| URL | `assessment.vehicledailycheck.com` | VDC apex or `app.` hostnames |
| Code | `/var/www/spotter-eld/` | `/var/www/vehicledailycheck/` |
| Database | `spotter_eld` | VDC database |
| Environment | `/var/www/spotter-eld/api/.env` | VDC `.env` |
| systemd | `spotter-eld-api.service` | `vehicledailycheck-api.service` |
| gunicorn | `127.0.0.1:8001` | `127.0.0.1:8000` (VDC) |
| nginx | `assessment.vehicledailycheck.com.conf` | VDC site configs |

WSGI module: `config.wsgi:application`  
Production frontend: same-origin `/api` (empty `VITE_API_BASE_URL`).

---

## Isolation checklist

Before running install or deploy commands:

- [ ] Spotter API listens on port **8001** only
- [ ] Database name is **`spotter_eld`**
- [ ] All paths are under **`/var/www/spotter-eld`**
- [ ] Do not stop or restart `vehicledailycheck-api`
- [ ] Do not edit VDC `.env` or VDC nginx configuration

---

## 1. DNS

Add an **A** record: host `assessment` → Vultr IP `78.141.194.242` (same as `vehicledailycheck.com`).

```bash
dig +short assessment.vehicledailycheck.com
# expected: 78.141.194.242
```

---

## 2. Postgres

```bash
sudo -u postgres psql -c "CREATE DATABASE spotter_eld;"
```

Recommended dedicated role:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER spotter_eld WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE spotter_eld TO spotter_eld;
\c spotter_eld
GRANT ALL ON SCHEMA public TO spotter_eld;
ALTER SCHEMA public OWNER TO spotter_eld;
SQL
```

If the role already exists, skip `CREATE USER` and apply only the `GRANT` / schema statements (or `ALTER USER` to update the password).

---

## 3. Directories and clone

```bash
sudo mkdir -p /var/www/spotter-eld /var/log/spotter-eld /var/www/certbot
sudo chown -R deploy:deploy /var/www/spotter-eld
sudo chown -R www-data:www-data /var/log/spotter-eld

sudo -u deploy git clone https://github.com/ather031/spotter-eld-trip-planner.git /var/www/spotter-eld/repo
```

---

## 4. Python environment, `.env`, and migrate

```bash
sudo mkdir -p /var/www/spotter-eld/api
sudo -u deploy python3 -m venv /var/www/spotter-eld/api/.venv

sudo -u deploy rsync -a --delete \
  --exclude '.venv' --exclude '.env' --exclude '__pycache__' --exclude 'staticfiles' \
  /var/www/spotter-eld/repo/backend/ /var/www/spotter-eld/api/

sudo -u deploy cp /var/www/spotter-eld/repo/deploy/env.production.example /var/www/spotter-eld/api/.env
sudo -u deploy nano /var/www/spotter-eld/api/.env
```

Set at least `DJANGO_SECRET_KEY` and `DATABASE_URL` (or discrete `POSTGRES_*` variables). Host-related values in the example are already scoped to `assessment.vehicledailycheck.com`.

Generate a secret:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

```bash
cd /var/www/spotter-eld/api
sudo -u deploy bash -lc 'source .venv/bin/activate && pip install -r requirements.txt && python manage.py migrate --noinput'

sudo chown www-data:www-data /var/www/spotter-eld/api/.env
sudo chmod 600 /var/www/spotter-eld/api/.env
```

---

## 5. systemd and nginx

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

Local health check (does not affect VDC):

```bash
curl -fsS http://127.0.0.1:8001/api/health/
```

---

## 6. TLS

DNS must resolve to this server before issuing a certificate.

```bash
sudo certbot --nginx -d assessment.vehicledailycheck.com
```

---

## 7. Build and deploy

```bash
cd /var/www/spotter-eld/repo
sudo bash scripts/deploy-spotter-eld.sh
```

The script pulls `main`, syncs the API, runs migrations, builds the frontend into `/var/www/spotter-eld/web`, sets ownership for `www-data`, restarts **only** `spotter-eld-api`, and reloads nginx.

---

## 8. Verification

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

Open the site and exercise the three demo presets (short, multi-day, high cycle).

---

## Routine redeploy

After pushing to GitHub:

```bash
cd /var/www/spotter-eld/repo
sudo bash scripts/deploy-spotter-eld.sh
```

---

## Hosting summary

> Deployed on a dedicated subdomain (`assessment.vehicledailycheck.com`) with an isolated process, database, and nginx site — separate from Vehicle Daily Check.

---

## Responsibilities

| Manual (SSH / DNS) | In this repository |
|--------------------|--------------------|
| DNS A record | `deploy/nginx/...` |
| Database and role creation | `deploy/env.production.example` |
| Clone, `.env`, certbot | `scripts/deploy-spotter-eld.sh` |
| Run deploy script | This runbook |
