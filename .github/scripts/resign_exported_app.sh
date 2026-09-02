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
host_path="$app_path/Contents/Helpers/supaterm-host"
helper_paths=(
  "$sp_path"
  "$app_path/Contents/MacOS/ap"
  "$host_path"
  "$app_path/Contents/Helpers/zmx"
)

validate_system_dylibs() {
  local dependency
  local dependencies
  local valid=1

  if ! dependencies=$(otool -L "$1"); then
    return 1
  fi

  while IFS= read -r dependency; do
    case "$dependency" in
      /System/Library/* | /usr/lib/*)
        ;;
      *)
        echo "::error::Unbundled dynamic dependency in $1: $dependency"
        valid=0
        ;;
    esac
  done < <(awk 'NR > 1 { print $1 }' <<< "$dependencies")

  [ "$valid" -eq 1 ]
}

validate_binary_shape() {
  local path=$1
  local name=$2
  local architectures
  local minos
  local permissions
  local valid=1

  architectures=$(lipo -archs "$path" 2>/dev/null || true)
  minos=$(xcrun vtool -show-build "$path" 2>/dev/null | awk '$1 == "minos" { print $2 }' | sort -u)
  permissions=$(stat -f '%Lp' "$path" 2>/dev/null || true)

  if [ "$architectures" != arm64 ]; then
    echo "::error::$name architectures are '$architectures', expected 'arm64'"
    valid=0
  fi
  if [ "$minos" != 26.0 ]; then
    echo "::error::$name deployment target is '$minos', expected '26.0'"
    valid=0
  fi
  if [ "$permissions" != 755 ]; then
    echo "::error::$name permissions are '$permissions', expected '755'"
    valid=0
  fi
  if ! validate_system_dylibs "$path"; then
    valid=0
  fi

  [ "$valid" -eq 1 ]
}

validate_host_binary() {
  local bundle_version
  local host_version
  local valid=1

  bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")

  if ! validate_binary_shape "$host_path" supaterm-host; then
    valid=0
  fi
  if ! nm -gU "$host_path" 2>/dev/null |
    awk '$NF == "_ghostty_terminal_new" { found = 1 } END { exit(found ? 0 : 1) }'; then
    echo "::error::supaterm-host does not contain _ghostty_terminal_new"
    valid=0
  fi
  if ! host_version=$("$host_path" version); then
    echo "::error::supaterm-host version command failed"
    valid=0
  elif [ "$host_version" != "supaterm-host $bundle_version" ]; then
    echo "::error::supaterm-host version is '$host_version', expected 'supaterm-host $bundle_version'"
    valid=0
  fi

  [ "$valid" -eq 1 ]
}

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
validate_host_binary
validate_binary_shape "$sp_path" sp
"$sp_path" --help > /dev/null
