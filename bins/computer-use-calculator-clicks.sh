#!/usr/bin/env bash
set -euo pipefail

sp_cli=${SUPATERM_CLI_PATH:-sp}
default_delay_seconds=0.5
delay_seconds=$default_delay_seconds
app_name=Calculator
app_bundle_id=""
mode=""
stream_logs=${SUPATERM_COMPUTER_USE_STREAM_LOGS:-1}
log_stream_pid=""

usage() {
  cat <<USAGE
Usage:
  ./bins/computer-use-calculator-clicks.sh --mode xy [options]
  ./bins/computer-use-calculator-clicks.sh --mode element [options]

Modes:
  xy       Resolve each button from the snapshot, then click with --x and --y.
  element  Resolve each button from the snapshot, then click with --element.

Options:
  --mode xy|element  Click mode.
  --delay seconds    Delay between clicks. Default: $default_delay_seconds
  --app name         Target app. Default: Calculator
  --bundle-id id     Target bundle ID.
  --sp path          sp CLI path. Default: SUPATERM_CLI_PATH or sp
  --stream-logs      Stream computer-use logs. Default
  --no-stream-logs   Disable computer-use log streaming.
  -h, --help         Show this help.
USAGE
}

die() {
  printf 'error: %s\n\n' "$1" >&2
  usage >&2
  exit 2
}

require_value() {
  local option=$1
  local value=${2:-}
  if [[ -z "$value" || "$value" == --* ]]; then
    die "$option requires a value"
  fi
}

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      require_value "$1" "${2:-}"
      mode=$2
      shift 2
      ;;
    --mode=*)
      mode=${1#*=}
      shift
      ;;
    --delay)
      require_value "$1" "${2:-}"
      delay_seconds=$2
      shift 2
      ;;
    --delay=*)
      delay_seconds=${1#*=}
      shift
      ;;
    --app)
      require_value "$1" "${2:-}"
      app_name=$2
      shift 2
      ;;
    --app=*)
      app_name=${1#*=}
      shift
      ;;
    --bundle-id)
      require_value "$1" "${2:-}"
      app_bundle_id=$2
      shift 2
      ;;
    --bundle-id=*)
      app_bundle_id=${1#*=}
      shift
      ;;
    --sp)
      require_value "$1" "${2:-}"
      sp_cli=$2
      shift 2
      ;;
    --sp=*)
      sp_cli=${1#*=}
      shift
      ;;
    --stream-logs)
      stream_logs=1
      shift
      ;;
    --no-stream-logs)
      stream_logs=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

if [[ -z "$mode" ]]; then
  die "missing --mode"
fi

case "$mode" in
  xy|element)
    ;;
  *)
    die "--mode must be xy or element"
    ;;
esac

timestamp() {
  date +"%Y-%m-%dT%H:%M:%S%z"
}

frontmost_app() {
  osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null || printf 'unknown'
}

log_state() {
  printf '[%s] %s frontmost=%s\n' "$(timestamp)" "$*" "$(frontmost_app)" >&2
}

cleanup() {
  if [[ -n "$log_stream_pid" ]]; then
    kill "$log_stream_pid" >/dev/null 2>&1 || true
    wait "$log_stream_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT

initial_frontmost=$(frontmost_app)
log_state "initial"

if [[ "$stream_logs" == "1" ]]; then
  log stream --style compact --level debug --predicate 'subsystem == "app.supabit.supaterm" AND category == "computer-use"' >&2 &
  log_stream_pid=$!
  sleep 0.2
fi

launch_command=("$sp_cli" computer-use launch --json)
app_filter=$app_name
if [[ -n "$app_bundle_id" ]]; then
  launch_command+=(--bundle-id "$app_bundle_id")
  app_filter=$app_bundle_id
else
  launch_command+=(--name "$app_name")
fi

log_state "before launch app=$app_name bundle=$app_bundle_id"
launch_json=$("${launch_command[@]}")
log_state "after launch app=$app_name bundle=$app_bundle_id"
LAUNCH_JSON=$launch_json python3 - <<'PY'
import json
import os

launch = json.loads(os.environ["LAUNCH_JSON"])
print(f'launch {launch["pid"]} {launch["name"]} active={launch["isActive"]}')
PY
sleep 0.5
log_state "after launch wait app=$app_name"

log_state "before windows app=$app_filter"
windows_json=$("$sp_cli" computer-use windows --app "$app_filter" --on-screen-only --json)
log_state "after windows app=$app_filter"
target=$(
  WINDOWS_JSON=$windows_json python3 - <<'PY'
import json
import os

windows = json.loads(os.environ["WINDOWS_JSON"])["windows"]
if not windows:
    raise SystemExit("no windows")
window = (
    next((item for item in windows if item.get("isOnScreen") and item.get("onCurrentSpace") is True), None)
    or next((item for item in windows if item.get("isOnScreen")), None)
    or windows[0]
)
print(f'{window["pid"]} {window["id"]}')
PY
)
read -r pid window <<< "$target"
log_state "target app=$app_name pid=$pid window=$window"

click_button() {
  local names=$1
  local snapshot
  local target
  local element
  local status
  local x
  local y

  log_state "before snapshot button=$names"
  snapshot=$("$sp_cli" computer-use snapshot --pid "$pid" --window "$window" --json)
  log_state "after snapshot button=$names"
  target=$(
    SNAPSHOT_JSON=$snapshot python3 - "$names" <<'PY'
import json
import os
import sys

snapshot = json.loads(os.environ["SNAPSHOT_JSON"])
names = set(sys.argv[1].split("|"))
frame = snapshot["frame"]
screenshot = snapshot["screenshot"]
x_scale = screenshot["width"] / frame["width"]
y_scale = screenshot["height"] / frame["height"]

for element in snapshot["elements"]:
    if element.get("identifier") in names or element.get("description") in names:
        element_frame = element["frame"]
        x = (element_frame["x"] + element_frame["width"] / 2 - frame["x"]) * x_scale
        y = (element_frame["y"] + element_frame["height"] / 2 - frame["y"]) * y_scale
        print(f'{element["elementIndex"]} {round(x)} {round(y)}')
        raise SystemExit(0)

raise SystemExit(f"missing button: {sys.argv[1]}")
PY
  )
  read -r element x y <<< "$target"
  log_state "button=$names mode=$mode element=$element x=$x y=$y"
  log_state "before click button=$names mode=$mode"
  status=0
  if [[ "$mode" == "element" ]]; then
    "$sp_cli" computer-use click --pid "$pid" --window "$window" --element "$element" --action press --json || status=$?
  else
    "$sp_cli" computer-use click --pid "$pid" --window "$window" --x "$x" --y "$y" --json || status=$?
  fi
  if [[ "$status" -eq 0 ]]; then
    log_state "after click button=$names status=ok"
  else
    log_state "after click button=$names status=$status"
    return "$status"
  fi
}

buttons=(
  "Clear|AllClear"
  One Two Three Four Five Six Seven Eight Nine
  Add
  Nine Eight Seven Six Five Four Three Two One
  Equals
)

for button in "${buttons[@]}"; do
  click_button "$button"
  sleep "$delay_seconds"
done

log_state "before final snapshot"
final_snapshot=$("$sp_cli" computer-use snapshot --pid "$pid" --window "$window" --json)
log_state "after final snapshot"
FINAL_SNAPSHOT_JSON=$final_snapshot python3 - <<'PY'
import json
import os

snapshot = json.loads(os.environ["FINAL_SNAPSHOT_JSON"])
values = [
    element
    for element in snapshot["elements"]
    if element.get("value") and element.get("role") in {"AXStaticText", "AXTextField", "AXTextArea"}
]
if values:
    display = max(values, key=lambda element: element.get("frame", {}).get("y", 0))["value"].replace("\u200e", "")
    print(f"display {display}")
else:
    print(f'elements {len(snapshot["elements"])}')
PY
final_frontmost=$(frontmost_app)
if [[ "$initial_frontmost" != "unknown" && "$final_frontmost" != "$initial_frontmost" ]]; then
  printf 'frontmost changed: %s -> %s\n' "$initial_frontmost" "$final_frontmost" >&2
  exit 1
fi
log_state "done"
