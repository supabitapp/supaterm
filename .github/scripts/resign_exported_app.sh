#!/usr/bin/env bash
set -euo pipefail

: "${DEVELOPER_ID_IDENTITY_SHA:?}"

export_root=${1:?}
app_path=$(find "$export_root" -maxdepth 3 -name 'supaterm.app' -print -quit)
if [ -z "$app_path" ]; then
  echo "::error::supaterm.app not found under $export_root"
  exit 1
fi

sign_path() {
  local path=$1
  local -a args=(-f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v)

  case "$path" in
    *.app|*.appex|*.xpc)
      args+=(--preserve-metadata=entitlements,requirements,flags)
      ;;
  esac

  codesign "${args[@]}" "$path"
}

code_roots=(
  "$app_path/Contents/Frameworks"
  "$app_path/Contents/PlugIns"
  "$app_path/Contents/XPCServices"
  "$app_path/Contents/Library/LoginItems"
)

sp_path="$app_path/Contents/MacOS/sp"
helper_paths=(
  "$sp_path"
  "$app_path/Contents/MacOS/ap"
  "$app_path/Contents/Helpers/zmx"
)

for path in "${helper_paths[@]}"; do
  if [ -L "$path" ]; then
    echo "::error::Required executable must not be a symbolic link: $path"
    exit 1
  fi
  if [ ! -f "$path" ]; then
    echo "::error::Required executable is missing or not a regular file: $path"
    exit 1
  fi
  if [ ! -x "$path" ]; then
    echo "::error::Required executable is not executable: $path"
    exit 1
  fi
done

code_paths=()
for root in "${code_roots[@]}"; do
  if [ ! -d "$root" ]; then
    continue
  fi

  while IFS= read -r -d '' path; do
    code_paths+=("$path")
  done < <(
    find "$root" \
      \( -type d \( -name '*.app' -o -name '*.appex' -o -name '*.framework' -o -name '*.xpc' \) \
      -o -type f \( -name '*.dylib' -o -perm -111 \) \) \
      -print0
  )
done

if [ "${#code_paths[@]}" -gt 0 ]; then
  while IFS=$'\t' read -r _ path; do
    sign_path "$path"
  done < <(
    for path in "${code_paths[@]}"; do
      slash_count=${path//[^\/]/}
      printf '%s\t%s\n' "${#slash_count}" "$path"
    done | sort -rn -k1,1
  )
fi

for path in "${helper_paths[@]}"; do
  sign_path "$path"
done

codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp --preserve-metadata=entitlements,requirements,flags -v "$app_path"

for path in "${helper_paths[@]}"; do
  codesign --verify --strict --verbose=4 "$path"
done

codesign -vvv --deep --strict "$app_path"
"$sp_path" --help > /dev/null
