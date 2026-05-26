#!/usr/bin/env bash
set -euo pipefail

iterations=200
burst=1
delay_ms=30
lifetime_ms=0
target="${SUPATERM_TAB_ID:-}"
direction="right"
layout="keep"

usage() {
  cat <<'EOF'
Usage: stress-child-exits.sh [options]

Options:
  --in <selector>       Tab or pane selector for split target.
  --iterations <n>      Number of iterations. Default: 200
  --burst <n>           Splits per iteration. Default: 1
  --delay-ms <n>        Delay between iterations in ms. Default: 30
  --lifetime-ms <n>     Child process lifetime in ms before exit. Default: 0
  --direction <dir>     Split direction: right|left|down|up. Default: right
  --layout <layout>     Split layout: keep|equalize. Default: keep
  -h, --help            Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --in)
      target="${2:-}"
      shift 2
      ;;
    --iterations)
      iterations="${2:-}"
      shift 2
      ;;
    --burst)
      burst="${2:-}"
      shift 2
      ;;
    --delay-ms)
      delay_ms="${2:-}"
      shift 2
      ;;
    --lifetime-ms)
      lifetime_ms="${2:-}"
      shift 2
      ;;
    --direction)
      direction="${2:-}"
      shift 2
      ;;
    --layout)
      layout="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$iterations" =~ ^[0-9]+$ ]] || (( iterations <= 0 )); then
  echo "--iterations must be a positive integer" >&2
  exit 2
fi

if ! [[ "$burst" =~ ^[0-9]+$ ]] || (( burst <= 0 )); then
  echo "--burst must be a positive integer" >&2
  exit 2
fi

if ! [[ "$delay_ms" =~ ^[0-9]+$ ]]; then
  echo "--delay-ms must be a non-negative integer" >&2
  exit 2
fi

if ! [[ "$lifetime_ms" =~ ^[0-9]+$ ]]; then
  echo "--lifetime-ms must be a non-negative integer" >&2
  exit 2
fi

if [[ -z "$target" ]]; then
  echo "Missing split target. Pass --in <selector> or run inside a Supaterm pane." >&2
  exit 2
fi

delay_seconds=$(awk "BEGIN { printf \"%.3f\", ${delay_ms}/1000 }")
lifetime_seconds=$(awk "BEGIN { printf \"%.3f\", ${lifetime_ms}/1000 }")

if (( lifetime_ms == 0 )); then
  child_script='exit 0'
else
  child_script="sleep ${lifetime_seconds}; exit 0"
fi

success=0
failed=0

echo "stress-child-exits: target=${target} iterations=${iterations} burst=${burst} delay_ms=${delay_ms} lifetime_ms=${lifetime_ms} direction=${direction} layout=${layout}"

for ((i = 1; i <= iterations; i++)); do
  for ((j = 1; j <= burst; j++)); do
    if sp pane split \
      --in "$target" \
      --no-focus \
      --layout "$layout" \
      "$direction" \
      --script "$child_script" \
      --quiet
    then
      success=$((success + 1))
    else
      failed=$((failed + 1))
    fi
  done
  echo "iteration=${i}/${iterations} success=${success} failed=${failed}"
  if (( delay_ms > 0 )); then
    sleep "$delay_seconds"
  fi
done

echo "done success=${success} failed=${failed}"

if (( failed > 0 )); then
  exit 1
fi
