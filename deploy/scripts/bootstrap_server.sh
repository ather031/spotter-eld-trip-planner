#!/usr/bin/env bash
# One-time server bootstrap for Spotter ELD (run with sudo or as root-capable deploy).
# Does NOT modify Vehicle Daily Check nginx/systemd/env.
set -euo pipefail

DOMAIN=assessment.vehicledailycheck.com
ROOT=/var/www/spotter-eld
REPO_URL="${SPOTTER_REPO_URL:-https://github.com/ather031/spotter-eld-trip-planner.git}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"

echo "==> Bootstrap Spotter ELD ($DOMAIN)"

id "$DEPLOY_USER" >/dev/null

mkdir -p "$ROOT" /var/log/spotter-eld /var/www/certbot
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$ROOT" /var/log/spotter-eld

if [[ ! -d "$ROOT/repo/.git" ]]; then
  sudo -u "$DEPLOY_USER" git clone "$REPO_URL" "$ROOT/repo"
fi

# Postgres role + DB (idempotent-ish)
DB_PASS="${SPOTTER_DB_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 28)}"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spotter_eld') THEN
    CREATE ROLE spotter_eld LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE spotter_eld OWNER spotter_eld'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'spotter_eld')\gexec
GRANT ALL PRIVILEGES ON DATABASE spotter_eld TO spotter_eld;
SQL

# .env if missing
if [[ ! -f "$ROOT/api/.env" ]]; then
  mkdir -p "$ROOT/api"
  SECRET=$(openssl rand -hex 32)
  # If role already existed, password above may not have applied — operator must set.
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
  echo "Wrote $ROOT/api/.env (DB password generated for new role)."
else
  echo "Keeping existing $ROOT/api/.env"
fi

# systemd unit
install -m 644 "$ROOT/repo/deploy/systemd/spotter-eld-api.service" /etc/systemd/system/spotter-eld-api.service
systemctl daemon-reload
systemctl enable spotter-eld-api.service

# nginx site (HTTP-only first if certs missing)
NGINX_AVAIL=/etc/nginx/sites-available/${DOMAIN}.conf
NGINX_ENABLED=/etc/nginx/sites-enabled/${DOMAIN}.conf
install -m 644 "$ROOT/repo/deploy/nginx/${DOMAIN}.conf" "$NGINX_AVAIL"

# If certs not present yet, install a temporary HTTP-only server for ACME
if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  cat > "$NGINX_AVAIL" <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name assessment.vehicledailycheck.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    root /var/www/spotter-eld/web;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
fi

ln -sfn "$NGINX_AVAIL" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx

echo "==> Bootstrap files ready. Next:"
echo "    1) DNS A record: ${DOMAIN} -> this server"
echo "    2) sudo -u ${DEPLOY_USER} bash $ROOT/repo/deploy/scripts/remote_deploy.sh"
echo "    3) sudo certbot --nginx -d ${DOMAIN}"
echo "    4) Re-install full nginx conf from deploy/nginx if certbot didn't rewrite it"
