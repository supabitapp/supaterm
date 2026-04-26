#!/usr/bin/env bash
set -euo pipefail

sp_cli=${SUPATERM_CLI_PATH:-sp}
delay_seconds=${1:-1.4}
lead_seconds=${2:-3}
app_name=${3:-Calculator}
log_stream_pid=""

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

if [[ "${SUPATERM_COMPUTER_USE_STREAM_LOGS:-1}" == "1" ]]; then
  log stream --style compact --level debug --predicate 'subsystem == "app.supabit.supaterm" AND category == "computer-use"' >&2 &
  log_stream_pid=$!
  sleep 0.2
fi

log_state "before open app=$app_name"
open -g -a "$app_name"
log_state "after open app=$app_name"
sleep 0.5
log_state "after launch wait app=$app_name"
sleep "$lead_seconds"
log_state "after lead wait app=$app_name"

log_state "before windows app=$app_name"
windows_json=$("$sp_cli" computer-use windows --app "$app_name" --json)
log_state "after windows app=$app_name"
target=$(
  WINDOWS_JSON=$windows_json python3 - <<'PY'
import json
import os

windows = json.loads(os.environ["WINDOWS_JSON"])["windows"]
window = next((item for item in windows if item.get("isOnScreen")), windows[0])
print(f'{window["pid"]} {window["id"]}')
PY
)
read -r pid window <<< "$target"
log_state "target app=$app_name pid=$pid window=$window"

click_button() {
  local names=$1
  local snapshot
  local point
  local x
  local y

  log_state "before snapshot button=$names"
  snapshot=$("$sp_cli" computer-use snapshot --pid "$pid" --window "$window" --json)
  log_state "after snapshot button=$names"
  point=$(
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
        print(f"{round(x)} {round(y)}")
        raise SystemExit(0)

raise SystemExit(f"missing button: {sys.argv[1]}")
PY
  )
  read -r x y <<< "$point"
  log_state "button=$names x=$x y=$y"
  log_state "before click button=$names"
  if "$sp_cli" computer-use click --pid "$pid" --window "$window" --x "$x" --y "$y" --json; then
    log_state "after click button=$names status=ok"
  else
    local status=$?
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
    if element.get("role") == "AXStaticText" and "value" in element
]
display = max(values, key=lambda element: element["frame"]["y"])["value"].replace("\u200e", "")
print(f"display {display}")
PY
log_state "done"
