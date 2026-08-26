#!/usr/bin/env bash
# Idempotent deploy for Spotter ELD on the VPS.
# Run on the server (needs sudo for systemctl/nginx/chown):
#   cd /var/www/spotter-eld/repo && sudo bash scripts/deploy-spotter-eld.sh
#
# Isolation: only touches /var/www/spotter-eld, spotter-eld-api, assessment nginx site.
# Never restarts vehicledailycheck-api or edits VDC .env.
set -euo pipefail

ROOT=/var/www/spotter-eld
REPO="$ROOT/repo"
API="$ROOT/api"
WEB="$ROOT/web"
BRANCH="${SPOTTER_BRANCH:-main}"
DOMAIN=assessment.vehicledailycheck.com

if [[ ! -d "$REPO/.git" ]]; then
  echo "ERROR: clone the repo to $REPO first (see docs/deploy/assessment-vehicledailycheck.md)."
  exit 1
fi

echo "==> [1/6] git pull ($BRANCH)"
cd "$REPO"
# Prefer deploy user for git if present
if id deploy >/dev/null 2>&1 && [[ "$(id -u)" -eq 0 ]]; then
  sudo -u deploy git fetch --prune origin
  sudo -u deploy git checkout "$BRANCH"
  sudo -u deploy git pull --ff-only origin "$BRANCH"
else
  git fetch --prune origin
  git checkout "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

echo "==> [2/6] sync backend → $API (preserve .venv + .env)"
mkdir -p "$API"
rsync -a --delete \
  --exclude '.venv' \
  --exclude '.env' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'staticfiles' \
  --exclude '*.pyc' \
  "$REPO/backend/" "$API/"

if [[ ! -f "$API/.env" ]]; then
  echo "ERROR: missing $API/.env — copy deploy/env.production.example and fill secrets."
  exit 1
fi

if [[ ! -d "$API/.venv" ]]; then
  echo "==> creating venv"
  python3 -m venv "$API/.venv"
fi

# shellcheck disable=SC1091
source "$API/.venv/bin/activate"
pip install -q --upgrade pip
pip install -q -r "$API/requirements.txt"

echo "==> [3/6] migrate + collectstatic"
cd "$API"
python manage.py migrate --noinput
python manage.py collectstatic --noinput

echo "==> [4/6] build frontend → $WEB (same-origin /api)"
cd "$REPO/frontend"
if [[ ! -d node_modules ]]; then
  npm ci
else
  npm ci --prefer-offline
fi
# Empty VITE_API_BASE_URL → browser calls relative /api (nginx proxies to :8001)
rm -rf dist
VITE_API_BASE_URL= npm run build
mkdir -p "$WEB"
rsync -a --delete "$REPO/frontend/dist/" "$WEB/"

echo "==> [5/6] permissions (www-data runs gunicorn)"
chown -R www-data:www-data "$API" "$WEB"
# Keep secrets tight
if [[ -f "$API/.env" ]]; then
  chown www-data:www-data "$API/.env"
  chmod 600 "$API/.env"
fi
# venv must stay executable by www-data
chown -R www-data:www-data "$API/.venv"
mkdir -p /var/log/spotter-eld
chown -R www-data:www-data /var/log/spotter-eld
# repo can stay owned by deploy for git pull
if id deploy >/dev/null 2>&1; then
  chown -R deploy:deploy "$REPO"
fi

echo "==> [6/6] restart API + reload nginx"
systemctl restart spotter-eld-api.service
systemctl is-active --quiet spotter-eld-api.service || {
  echo "API failed — journalctl -u spotter-eld-api -n 80 --no-pager"
  exit 1
}

if [[ -f "/etc/nginx/sites-enabled/${DOMAIN}.conf" ]] || \
   [[ -L "/etc/nginx/sites-enabled/${DOMAIN}.conf" ]]; then
  nginx -t
  systemctl reload nginx
fi

echo "==> smoke checks (wait for gunicorn)"
ok=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null http://127.0.0.1:8001/api/health/; then
    echo "local health 200 (attempt $i)"
    ok=1
    break
  fi
  sleep 1
done
if [[ "$ok" -ne 1 ]]; then
  echo "ERROR: API did not become healthy on :8001"
  journalctl -u spotter-eld-api -n 80 --no-pager || true
  exit 1
fi

curl -fsS -o /dev/null -w "public  %{http_code}\n" "https://${DOMAIN}/api/health/" \
  || curl -fsS -o /dev/null -w "http    %{http_code}\n" "http://${DOMAIN}/api/health/" \
  || true

echo "==> Deploy complete → https://${DOMAIN}"
