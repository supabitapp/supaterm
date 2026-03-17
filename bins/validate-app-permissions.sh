#!/usr/bin/env bash
set -euo pipefail

app_path="${1:-${APP:-}}"
configuration="${2:-${CONFIGURATION:-Release}}"

if [ -z "$app_path" ]; then
  echo "usage: $0 /path/to/supaterm.app [Debug|Release]" >&2
  exit 1
fi

if [ ! -d "$app_path" ]; then
  echo "error: App bundle not found at $app_path" >&2
  exit 1
fi

if [ "$configuration" != "Debug" ] && [ "$configuration" != "Release" ]; then
  echo "error: CONFIGURATION must be Debug or Release (got $configuration)" >&2
  exit 1
fi

info_plist="$app_path/Contents/Info.plist"
if [ ! -f "$info_plist" ]; then
  echo "error: Missing Info.plist at $info_plist" >&2
  exit 1
fi

executable_name="$(/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$info_plist" 2>/dev/null || true)"
if [ -z "$executable_name" ]; then
  echo "error: Could not read CFBundleExecutable from $info_plist" >&2
  exit 1
fi

executable_path="$app_path/Contents/MacOS/$executable_name"
if [ ! -f "$executable_path" ]; then
  echo "error: Missing executable at $executable_path" >&2
  exit 1
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

entitlements_plist="$temp_dir/entitlements.plist"
if ! codesign -d --entitlements :- "$executable_path" >"$entitlements_plist" 2>/dev/null; then
  echo "error: Failed to extract entitlements from $executable_path" >&2
  exit 1
fi

errors=()

add_error() {
  errors+=("$1")
}

check_plist_bool() {
  local plist_path="$1"
  local key="$2"
  local label="$3"
  local actual

  if actual="$(/usr/libexec/PlistBuddy -c "Print :$key" "$plist_path" 2>/dev/null)"; then
    :
  else
    add_error "$label missing $key"
    return
  fi

  if [ "$actual" != "true" ]; then
    add_error "$label $key expected true but found $actual"
  fi
}

check_info_string() {
  local key="$1"
  local expected="$2"
  local actual

  if actual="$(/usr/libexec/PlistBuddy -c "Print :$key" "$info_plist" 2>/dev/null)"; then
    :
  else
    add_error "Info.plist missing $key"
    return
  fi

  if [ "$actual" != "$expected" ]; then
    add_error "Info.plist $key expected '$expected' but found '$actual'"
  fi
}

check_plist_absent() {
  local plist_path="$1"
  local key="$2"
  local label="$3"

  if /usr/libexec/PlistBuddy -c "Print :$key" "$plist_path" >/dev/null 2>&1; then
    add_error "$label unexpectedly contains $key"
  fi
}

for entitlement in \
  "com.apple.security.automation.apple-events" \
  "com.apple.security.device.audio-input" \
  "com.apple.security.device.camera" \
  "com.apple.security.personal-information.addressbook" \
  "com.apple.security.personal-information.calendars" \
  "com.apple.security.personal-information.location" \
  "com.apple.security.personal-information.photos-library"
do
  check_plist_bool "$entitlements_plist" "$entitlement" "Entitlements"
done

if [ "$configuration" = "Debug" ]; then
  check_plist_bool \
    "$entitlements_plist" \
    "com.apple.security.cs.disable-library-validation" \
    "Entitlements"
else
  check_plist_absent \
    "$entitlements_plist" \
    "com.apple.security.cs.disable-library-validation" \
    "Entitlements"
fi

check_info_string \
  "NSAppleEventsUsageDescription" \
  "A program running within Supaterm would like to use AppleScript."
check_info_string \
  "NSBluetoothAlwaysUsageDescription" \
  "A program running within Supaterm would like to use Bluetooth."
check_info_string \
  "NSCalendarsUsageDescription" \
  "A program running within Supaterm would like to access your Calendar."
check_info_string \
  "NSCameraUsageDescription" \
  "A program running within Supaterm would like to use the camera."
check_info_string \
  "NSContactsUsageDescription" \
  "A program running within Supaterm would like to access your Contacts."
check_info_string \
  "NSLocalNetworkUsageDescription" \
  "A program running within Supaterm would like to access the local network."
check_info_string \
  "NSLocationUsageDescription" \
  "A program running within Supaterm would like to access your location information."
check_info_string \
  "NSMicrophoneUsageDescription" \
  "A program running within Supaterm would like to use your microphone."
check_info_string \
  "NSMotionUsageDescription" \
  "A program running within Supaterm would like to access motion data."
check_info_string \
  "NSPhotoLibraryUsageDescription" \
  "A program running within Supaterm would like to access your Photo Library."
check_info_string \
  "NSRemindersUsageDescription" \
  "A program running within Supaterm would like to access your reminders."
check_info_string \
  "NSSpeechRecognitionUsageDescription" \
  "A program running within Supaterm would like to use speech recognition."
check_info_string \
  "NSSystemAdministrationUsageDescription" \
  "A program running within Supaterm requires elevated privileges."

if [ "${#errors[@]}" -gt 0 ]; then
  printf 'error: App permission validation failed for %s (%s)\n' "$app_path" "$configuration" >&2
  for error in "${errors[@]}"; do
    printf '  - %s\n' "$error" >&2
  done
  exit 1
fi

printf 'Validated app permissions for %s (%s)\n' "$app_path" "$configuration"
