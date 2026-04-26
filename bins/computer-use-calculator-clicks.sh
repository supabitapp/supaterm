#!/usr/bin/env bash
set -euo pipefail

sp_cli=${SUPATERM_CLI_PATH:-sp}
delay_seconds=${1:-1.4}
lead_seconds=${2:-3}
app_name=${3:-Calculator}

open -a "$app_name"
sleep 0.5
open -a Finder
sleep "$lead_seconds"

windows_json=$("$sp_cli" computer-use windows --app "$app_name" --json)
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

click_button() {
  local names=$1
  local snapshot
  local point
  local x
  local y

  snapshot=$("$sp_cli" computer-use snapshot --pid "$pid" --window "$window" --json)
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
  printf '%s %s %s\n' "$names" "$x" "$y" >&2
  "$sp_cli" computer-use click --pid "$pid" --window "$window" --x "$x" --y "$y" --json
}

for button in "Clear|AllClear" One Two Add Four Five Equals; do
  click_button "$button"
  sleep "$delay_seconds"
done

final_snapshot=$("$sp_cli" computer-use snapshot --pid "$pid" --window "$window" --json)
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
