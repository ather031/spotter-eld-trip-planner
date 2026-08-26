#!/usr/bin/env bash
# Deploy / refresh Spotter ELD on the VPS (run AS deploy on the server).
# Usage (on VPS):
#   bash /var/www/spotter-eld/repo/deploy/scripts/remote_deploy.sh
set -euo pipefail

ROOT=/var/www/spotter-eld
REPO="$ROOT/repo"
API="$ROOT/api"
WEB="$ROOT/web"
BRANCH="${SPOTTER_BRANCH:-main}"

echo "==> Spotter ELD deploy ($BRANCH)"

if [[ ! -d "$REPO/.git" ]]; then
  echo "ERROR: $REPO is not a git clone. Clone the assessment repo there first."
  exit 1
fi

cd "$REPO"
git fetch --prune origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# --- Backend ---
mkdir -p "$API"
# Sync backend tree into api/ (keep .venv and .env)
rsync -a --delete \
  --exclude '.venv' \
  --exclude '.env' \
  --exclude '__pycache__' \
  --exclude '.pytest_cache' \
  --exclude 'staticfiles' \
  "$REPO/backend/" "$API/"

if [[ ! -f "$API/.env" ]]; then
  echo "ERROR: missing $API/.env — copy deploy/env.production.example and fill secrets."
  exit 1
fi

if [[ ! -d "$API/.venv" ]]; then
  python3 -m venv "$API/.venv"
fi
# shellcheck disable=SC1091
source "$API/.venv/bin/activate"
pip install -q --upgrade pip
pip install -q -r "$API/requirements.txt"

cd "$API"
python manage.py migrate --noinput
python manage.py collectstatic --noinput

# --- Frontend ---
cd "$REPO/frontend"
if command -v npm >/dev/null 2>&1; then
  npm ci
  # Empty VITE_API_BASE_URL → same-origin /api via nginx
  VITE_API_BASE_URL= npm run build
  mkdir -p "$WEB"
  rsync -a --delete "$REPO/frontend/dist/" "$WEB/"
else
  echo "WARN: npm not found — skipped frontend build. Ensure $WEB is populated."
fi

sudo systemctl restart spotter-eld-api.service
sudo systemctl is-active --quiet spotter-eld-api.service && echo "API: active" || {
  echo "API failed — journalctl -u spotter-eld-api -n 50"
  exit 1
}

curl -fsS -o /dev/null -w "health %{http_code}\n" http://127.0.0.1:8001/api/health/ || true
echo "==> Done. Public: https://assessment.vehicledailycheck.com"
