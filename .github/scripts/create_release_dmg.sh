#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: $0 <app-path> <output-dmg> <signing-identity>" >&2
  exit 64
fi

app_path="$1"
output_path="$2"
signing_identity="$3"
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
background_svg="$repo_root/apps/mac/Distribution/dmg-background.svg"
settings_path="$repo_root/.github/scripts/dmg_settings.py"
icon_path=$(find "$app_path/Contents/Resources" -maxdepth 1 -name '*.icns' -print -quit)

test -d "$app_path"
test -f "$background_svg"
test -f "$settings_path"
test -n "$icon_path"
test -n "$signing_identity"

mkdir -p "$(dirname "$output_path")"
rm -f "$output_path"

temp_dir=$(mktemp -d)
trap 'rm -rf "$temp_dir"' EXIT
background_path="$temp_dir/dmg-background.png"
sips -s format png "$background_svg" --out "$background_path" >/dev/null
sips -s dpiWidth 144 -s dpiHeight 144 "$background_path" >/dev/null

dmgbuild \
  -s "$settings_path" \
  -Dapp="$app_path" \
  -Dbackground="$background_path" \
  -Dicon="$icon_path" \
  Supaterm \
  "$output_path"
codesign --force --sign "$signing_identity" "$output_path"
