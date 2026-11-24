#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$ROOT/.seensooner-runtime/processes.tsv"
LOG_DIR="$ROOT/logs/unified-launch"
STOP_LOG="$LOG_DIR/stop-last-run.log"
mkdir -p "$LOG_DIR"
PLATFORM="$(uname -s)"
WINDOWS_PROCESS_TABLE=""
WINDOWS_COMMAND_TABLE=""
case "$PLATFORM" in
  MINGW*|MSYS*|CYGWIN*)
    WINDOWS_PROCESS_TABLE="$(ps -W)"
    WINDOWS_COMMAND_TABLE="$(powershell.exe -NoProfile -Command 'Get-CimInstance Win32_Process | ForEach-Object { Write-Output ([string]$_.ProcessId + "`t" + [string]$_.CommandLine) }')"
    ;;
esac

if [[ ! -f "$STATE_FILE" ]]; then
  echo "No SeenSooner runtime state was found. Nothing was stopped."
  exit 0
fi

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

stopped=()
exited=()
skipped=()
failed=()

while IFS=$'\t' read -r name pid expected port url; do
  [[ "$name" == "name" ]] && continue
  if ! kill -0 "$pid" 2>/dev/null; then
    exited+=("$name")
    continue
  fi
  if ! pid_matches "$pid" "$expected"; then
    skipped+=("$name (PID $pid identity mismatch)")
    continue
  fi
  kill "$pid" 2>/dev/null || { failed+=("$name (PID $pid)"); continue; }
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  if kill -0 "$pid" 2>/dev/null; then
    if pid_matches "$pid" "$expected"; then kill -KILL "$pid" 2>/dev/null || true; fi
  fi
  if kill -0 "$pid" 2>/dev/null; then failed+=("$name (PID $pid)"); else stopped+=("$name (PID $pid)"); fi
done < "$STATE_FILE"

if [[ "${#failed[@]}" -eq 0 ]]; then rm -f -- "$STATE_FILE"; fi

join_or_none() {
  if [[ "$#" -eq 0 ]]; then
    printf 'none'
    return
  fi
  local output="$1"
  shift
  for item in "$@"; do output="$output; $item"; done
  printf '%s' "$output"
}
{
  echo "SeenSooner unified stop result."
  echo "Completed (UTC): $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Stopped: $(join_or_none ${stopped[@]+"${stopped[@]}"})"
  echo "Already exited: $(join_or_none ${exited[@]+"${exited[@]}"})"
  echo "Skipped for safety: $(join_or_none ${skipped[@]+"${skipped[@]}"})"
  echo "Failures: $(join_or_none ${failed[@]+"${failed[@]}"})"
} | tee "$STOP_LOG"

[[ "${#failed[@]}" -eq 0 ]] || { echo "One or more verified SeenSooner processes could not be stopped." >&2; exit 1; }
echo "Unified shutdown completed."
