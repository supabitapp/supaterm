#!/usr/bin/env bash
set -euo pipefail

candidates=()

if [ -n "${SUPATERM_CLI_PATH:-}" ]; then
  candidates+=("${SUPATERM_CLI_PATH}")
fi

if command -v sp >/dev/null 2>&1; then
  candidates+=("$(command -v sp)")
fi

candidates+=(
  "/Applications/supaterm.app/Contents/Resources/bin/sp"
  "/Applications/Supaterm.app/Contents/Resources/bin/sp"
)

for candidate in "${candidates[@]}"; do
  if [ -n "${candidate}" ] && [ -x "${candidate}" ]; then
    printf '%s\n' "${candidate}"
    exit 0
  fi
done

printf '%s\n' "Unable to resolve a runnable sp binary." >&2
printf '%s\n' "Expected SUPATERM_CLI_PATH, PATH, or an installed Supaterm app bundle." >&2
exit 1
