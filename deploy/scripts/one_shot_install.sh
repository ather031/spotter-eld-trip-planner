#!/usr/bin/env bash
# Full one-shot install for Spotter ELD on the VPS.
# Run:  sudo bash one_shot_install.sh
# Requires: DNS A record assessment.vehicledailycheck.com → this server (for TLS).
set -euo pipefail

DOMAIN=assessment.vehicledailycheck.com
ROOT=/var/www/spotter-eld
REPO_URL=https://github.com/ather031/spotter-eld-trip-planner.git
DEPLOY_USER=deploy

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

echo "==> [1/7] Directories"
mkdir -p "$ROOT" /var/log/spotter-eld /var/www/certbot
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT" /var/log/spotter-eld

echo "==> [2/7] Clone repo"
if [[ ! -d "$ROOT/repo/.git" ]]; then
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$ROOT/repo"
else
  sudo -u "$DEPLOY_USER" bash -lc "cd $ROOT/repo && git fetch origin && git checkout main && git pull --ff-only origin main"
fi

echo "==> [3/7] Postgres DB spotter_eld"
DB_PASS="$(openssl rand -base64 32 | tr -d '/+=\n' | head -c 28)"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotter_eld') THEN
    CREATE ROLE spotter_eld LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE spotter_eld PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL
# Create DB if missing
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='spotter_eld'" | grep -q 1; then
  sudo -u postgres createdb -O spotter_eld spotter_eld
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE spotter_eld TO spotter_eld;"
# Django needs schema rights on PG15+
sudo -u postgres psql -d spotter_eld -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON SCHEMA public TO spotter_eld;
ALTER SCHEMA public OWNER TO spotter_eld;
SQL

echo "==> [4/7] API .env"
mkdir -p "$ROOT/api"
SECRET="$(openssl rand -hex 32)"
cat > "$ROOT/api/.env" <<EOF
DJANGO_SECRET_KEY=${SECRET}
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN}
CSRF_TRUSTED_ORIGINS=https://${DOMAIN}
USE_X_FORWARDED_HOST=true
POSTGRES_DB=spotter_eld
POSTGRES_USER=spotter_eld
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
MAP_USER_AGENT=SpotterELDTripPlanner/1.0 (assessment; https://${DOMAIN})
MAP_HTTP_TIMEOUT=25
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
PHOTON_BASE_URL=https://photon.komoot.io
OSRM_BASE_URL=https://router.project-osrm.org
EOF
chown "$DEPLOY_USER:$DEPLOY_USER" "$ROOT/api/.env"
chmod 600 "$ROOT/api/.env"

echo "==> [5/7] App deploy (venv, migrate, frontend build)"
chmod +x "$ROOT/repo/deploy/scripts/remote_deploy.sh"
# Install unit before restart inside remote_deploy
install -m 644 "$ROOT/repo/deploy/systemd/spotter-eld-api.service" /etc/systemd/system/spotter-eld-api.service
systemctl daemon-reload
systemctl enable spotter-eld-api.service
# Ensure log files writable
touch /var/log/spotter-eld/gunicorn-access.log /var/log/spotter-eld/gunicorn-error.log
chown -R "$DEPLOY_USER:$DEPLOY_USER" /var/log/spotter-eld

sudo -u "$DEPLOY_USER" bash "$ROOT/repo/deploy/scripts/remote_deploy.sh"

echo "==> [6/7] Nginx (HTTP first for ACME)"
cat > "/etc/nginx/sites-available/${DOMAIN}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }

    root /var/www/spotter-eld/web;
    index index.html;
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    access_log /var/log/spotter-eld/access.log;
    error_log  /var/log/spotter-eld/error.log;
}
EOF
ln -sfn "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx

echo "==> [7/7] TLS via certbot (needs DNS pointed here)"
if dig +short "A" "${DOMAIN}" | grep -q .; then
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || {
    echo "WARN: certbot failed — site is on HTTP until DNS/cert succeeds."
    echo "      Re-run: certbot --nginx -d ${DOMAIN}"
  }
  # Prefer our full HTTPS template if certs exist
  if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    install -m 644 "$ROOT/repo/deploy/nginx/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}.conf"
    nginx -t && systemctl reload nginx
  fi
else
  echo "WARN: ${DOMAIN} has no A record yet. Add DNS A → $(curl -4 -fsS ifconfig.me || echo THIS_SERVER_IP)"
  echo "      Then: certbot --nginx -d ${DOMAIN}"
fi

echo
echo "==== Spotter ELD install complete ===="
echo "Health: curl -fsS http://127.0.0.1:8001/api/health/"
echo "Public: https://${DOMAIN}  (or http:// until TLS)"
systemctl --no-pager --full status spotter-eld-api.service | head -15 || true
