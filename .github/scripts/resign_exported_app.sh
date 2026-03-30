#!/usr/bin/env bash
set -euo pipefail

: "${DEVELOPER_ID_IDENTITY_SHA:?}"

export_root=${1:?}
app_path=$(find "$export_root" -maxdepth 3 -name 'supaterm.app' -print -quit)
if [ -z "$app_path" ]; then
  echo "::error::supaterm.app not found under $export_root"
  exit 1
fi

sparkle_dir=$(find "$app_path/Contents/Frameworks/Sparkle.framework/Versions" -mindepth 1 -maxdepth 1 -type d ! -name Current -print -quit)
if [ -z "$sparkle_dir" ]; then
  echo "::error::Sparkle framework version directory not found"
  exit 1
fi

sentry_framework="$app_path/Contents/Frameworks/Sentry.framework"
if [ ! -d "$sentry_framework" ]; then
  echo "::error::Sentry framework not found at $sentry_framework"
  exit 1
fi

sentry_binary="$sentry_framework/Sentry"
if [ ! -e "$sentry_binary" ] && [ -d "$sentry_framework/Versions" ]; then
  sentry_binary=$(find "$sentry_framework/Versions" -mindepth 2 -maxdepth 2 -type f -name Sentry -print -quit)
fi
if [ -z "${sentry_binary:-}" ] || [ ! -e "$sentry_binary" ]; then
  echo "::error::Sentry binary not found inside $sentry_framework"
  exit 1
fi

codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$sparkle_dir/XPCServices/Installer.xpc"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp --preserve-metadata=entitlements -v "$sparkle_dir/XPCServices/Downloader.xpc"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$sparkle_dir/Updater.app"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$sparkle_dir/Autoupdate"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$sparkle_dir/Sparkle"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$app_path/Contents/Frameworks/Sparkle.framework"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$sentry_binary"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp -v "$sentry_framework"
codesign -f -s "$DEVELOPER_ID_IDENTITY_SHA" -o runtime --timestamp --preserve-metadata=entitlements,requirements,flags -v "$app_path"
codesign -vvv --deep --strict "$app_path"
