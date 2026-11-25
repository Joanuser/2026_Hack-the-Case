#!/usr/bin/env bash
# Builds the four frontends for the hosted demo into web-dist/.
# The Python API (backend/server.py) then serves them from one address:
#   /patient/  /nurse/  /display/  /oversight/   (plus the landing page at /)
# Local development (setup-all / start-all) does not use this script.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$ROOT/web-dist"
rm -rf "$OUT"
mkdir -p "$OUT"

# Same-origin API: the apps call /api/... on the address they were loaded from.
export VITE_API_MODE=http
export VITE_API_BASE_URL=/
export VITE_MOCK_BACKEND=false

build_app() {
  local dir="$1" base="$2"
  echo "Building $dir -> /$base/"
  (cd "$ROOT/$dir" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run build -- --base="/$base/" --outDir="$OUT/$base" --emptyOutDir)
}

# Synthetic demo hospital location for the 150 m "Still here?" check (override for a real site).
VITE_SITE_CODES=ED-MAIN VITE_HOSPITAL_LAT="${VITE_HOSPITAL_LAT:-42.2830}" VITE_HOSPITAL_LNG="${VITE_HOSPITAL_LNG:--83.7300}" build_app patient-app patient
VITE_STAFF_API_TOKEN="${SEENSOONER_STAFF_TOKEN:-demo-staff-token}" \
VITE_STAFF_NAME="Demo ED staff" VITE_BACKEND_LABEL="Hosted W2 API" build_app nurse-app nurse
VITE_DEPARTMENT_NAME="Treatment-room waiting queue" build_app display-app display
build_app oversight-dashboard oversight

cp "$ROOT/deploy/landing.html" "$OUT/index.html"
echo "Built frontends into $OUT"
