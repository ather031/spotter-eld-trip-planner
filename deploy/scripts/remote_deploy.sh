#!/usr/bin/env bash
# Thin wrapper — canonical script is scripts/deploy-spotter-eld.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/scripts/deploy-spotter-eld.sh" "$@"
