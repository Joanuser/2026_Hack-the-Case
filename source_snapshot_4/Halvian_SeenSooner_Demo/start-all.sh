#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT/.seensooner-runtime"
STATE_FILE="$RUNTIME_DIR/processes.tsv"
LOG_DIR="$ROOT/logs/unified-launch"
START_LOG="$LOG_DIR/start-last-run.log"
if [[ -x "$ROOT/.venv/bin/python" ]]; then
  PYTHON="$ROOT/.venv/bin/python"
elif [[ -x "$ROOT/.venv/Scripts/python.exe" ]]; then
  PYTHON="$ROOT/.venv/Scripts/python.exe"
else
  echo "Python dependencies are not set up. Run ./setup-all.sh first." >&2
  exit 1
fi
mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
command -v node >/dev/null 2>&1 || { echo "Node.js was not found." >&2; exit 1; }

SERVICES=(api patient nurse display oversight)
PORTS=(8000 5173 5174 5175 5176)
URLS=(
  "http://127.0.0.1:8000/api/health"
  "http://127.0.0.1:5173/"
  "http://127.0.0.1:5174/"
  "http://127.0.0.1:5175/"
  "http://127.0.0.1:5176/"
)
NAMES=("Python API" "Patient App" "Nurse Dashboard" "Waiting Room Display" "AI Oversight Dashboard")
PLATFORM="$(uname -s)"
WINDOWS_PROCESS_TABLE=""
WINDOWS_COMMAND_TABLE=""

for application in patient-app nurse-app display-app oversight-dashboard; do
  [[ -f "$ROOT/$application/node_modules/vite/bin/vite.js" ]] || { echo "Missing dependencies for $application. Run ./setup-all.sh first." >&2; exit 1; }
done

pid_matches() {
  local pid="$1" expected="$2" command
  kill -0 "$pid" 2>/dev/null || return 1
  case "$PLATFORM" in
    MINGW*|MSYS*|CYGWIN*)
      local winpid
      winpid="$(printf '%s\n' "$WINDOWS_PROCESS_TABLE" | awk -v target="$pid" 'NR > 1 && $1 == target { print $4; exit }')"
      [[ -n "$winpid" ]] || return 1
      command="$(printf '%s\n' "$WINDOWS_COMMAND_TABLE" | awk -F '\t' -v target="$winpid" '$1 == target { sub(/^[^\t]*\t/, ""); print; exit }' | tr '\\' '/' | tr '[:upper:]' '[:lower:]')"
      expected="$(cygpath -m "$expected" | tr '[:upper:]' '[:lower:]')"
      ;;
    *)
      command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
      ;;
  esac
  [[ "$command" == *"$expected"* ]]
}

url_ready() {
  "$PYTHON" -c 'import sys,urllib.request; urllib.request.urlopen(sys.argv[1], timeout=2).read(1)' "$1" >/dev/null 2>&1
}

port_in_use() {
  "$PYTHON" -c 'import socket,sys; s=socket.socket(); s.settimeout(.3); code=s.connect_ex(("127.0.0.1",int(sys.argv[1]))); s.close(); raise SystemExit(0 if code==0 else 1)' "$1"
}

if [[ -f "$STATE_FILE" ]]; then
  case "$PLATFORM" in
    MINGW*|MSYS*|CYGWIN*)
      WINDOWS_PROCESS_TABLE="$(ps -W)"
      WINDOWS_COMMAND_TABLE="$(powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | ForEach-Object { Write-Output ([string]$_.ProcessId + "`t" + [string]$_.CommandLine) }')"
      ;;
  esac
  valid=0
  ready=0
  while IFS=$'\t' read -r name pid expected port url; do
    [[ "$name" == "name" ]] && continue
    if pid_matches "$pid" "$expected"; then
      valid=$((valid + 1))
      url_ready "$url" && ready=$((ready + 1))
    fi
  done < "$STATE_FILE"
  if [[ "$valid" -eq 5 && "$ready" -eq 5 ]]; then
    echo "SeenSooner is already running from this project."
    printf '%s\n' "Python API: ${URLS[0]}" "Patient App: ${URLS[1]}" "Nurse Dashboard: ${URLS[2]}" "Waiting Room Display: ${URLS[3]}" "AI Oversight Dashboard: ${URLS[4]}"
    exit 0
  fi
  [[ "$valid" -eq 0 ]] || { echo "Some tracked SeenSooner services are still running. Run ./stop-all.sh, then retry." >&2; exit 1; }
  rm -f -- "$STATE_FILE"
fi

for port in "${PORTS[@]}"; do
  if port_in_use "$port"; then
    echo "Startup stopped because required port $port is already in use. No process was terminated." >&2
    exit 1
  fi
done

printf 'name\tpid\texpected\tport\turl\n' > "$STATE_FILE"
STARTED_PIDS=()

cleanup_failed_start() {
  for pid in "${STARTED_PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  done
  rm -f -- "$STATE_FILE"
}
trap cleanup_failed_start ERR INT TERM

start_service() {
  local index="$1" name="${NAMES[$1]}" key="${SERVICES[$1]}" port="${PORTS[$1]}" url="${URLS[$1]}" expected directory
  if [[ "$key" == "api" ]]; then
    expected="$ROOT/backend/server.py"
    (cd "$ROOT/backend" && exec "$PYTHON" -u "$expected" --host 127.0.0.1 --port "$port") >"$LOG_DIR/$key.out.log" 2>"$LOG_DIR/$key.err.log" &
  else
    case "$key" in
      patient) directory="patient-app" ;;
      nurse) directory="nurse-app" ;;
      display) directory="display-app" ;;
      oversight) directory="oversight-dashboard" ;;
    esac
    expected="$ROOT/$directory/node_modules/vite/bin/vite.js"
    (cd "$ROOT/$directory" && exec node "$expected" --host 127.0.0.1 --port "$port" --strictPort) >"$LOG_DIR/$key.out.log" 2>"$LOG_DIR/$key.err.log" &
  fi
  local pid=$!
  STARTED_PIDS+=("$pid")
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$pid" "$expected" "$port" "$url" >> "$STATE_FILE"
  echo "Started $name on port $port (PID $pid)."
}

for index in 0 1 2 3 4; do start_service "$index"; done

for index in 0 1 2 3 4; do
  deadline=$((SECONDS + 60))
  until url_ready "${URLS[$index]}"; do
    (( SECONDS < deadline )) || { echo "${NAMES[$index]} did not become ready within 60 seconds." >&2; false; }
    sleep 0.4
  done
done

check_cors() {
  "$PYTHON" -c 'import sys,urllib.request; r=urllib.request.urlopen(urllib.request.Request(sys.argv[1],headers={"Origin":sys.argv[2]}),timeout=5); assert r.status==200 and r.headers.get("Access-Control-Allow-Origin")==sys.argv[2]' "$1" "$2"
}
check_cors "http://127.0.0.1:8000/api/public/queue" "http://127.0.0.1:5173"
check_cors "http://127.0.0.1:8000/api/public/queue" "http://127.0.0.1:5174"
check_cors "http://127.0.0.1:8000/api/public/queue" "http://127.0.0.1:5175"
check_cors "http://127.0.0.1:8000/api/oversight/summary" "http://127.0.0.1:5176"

trap - ERR INT TERM
{
  echo "SeenSooner unified startup completed successfully."
  echo "Completed (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "Python API: ${URLS[0]}" "Patient App: ${URLS[1]}" "Nurse Dashboard: ${URLS[2]}" "Waiting Room Display: ${URLS[3]}" "AI Oversight Dashboard: ${URLS[4]}"
  echo "All four frontends passed their shared-API CORS checks."
  echo "Stop command: ./stop-all.sh"
} > "$START_LOG"

echo "All SeenSooner services are ready."
printf '%s\n' "Python API: ${URLS[0]}" "Patient App: ${URLS[1]}" "Nurse Dashboard: ${URLS[2]}" "Waiting Room Display: ${URLS[3]}" "AI Oversight Dashboard: ${URLS[4]}"
echo "Shared API connectivity: PASS for all four frontends."
echo "Stop command: ./stop-all.sh"
