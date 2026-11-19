#!/usr/bin/env bash
# Keeps the app review VM on the latest stable Supaterm release. Run by supacode-review-update.timer as root.
set -Eeuo pipefail
cd /tmp

ROOT=${SUPACODE_REVIEW_ROOT:-/opt/supacode-review}
HOME_DIR=${SUPACODE_REVIEW_HOME:-/srv/supacode-review}
STATE="$HOME_DIR/state"
WORKSPACE="$HOME_DIR/workspace"
TOKEN=${SUPACODE_REVIEW_ADMIN_TOKEN_FILE:-/var/lib/supacode-review-access/admin.token}
BACKEND=http://127.0.0.1:3773
REPO=supabitapp/supaterm
SERVICE=supacode-review
ACCESS_SERVICE=supacode-review-access
STAGING="$ROOT/staging"
RESET_ARCHIVE=""

as_review() { sudo -u review env HOME="$HOME_DIR" "$@"; }

healthy() {
  local headers
  headers=$(mktemp)
  chmod 600 "$headers"
  printf 'Authorization: Bearer %s\nx-supaterm-orchestration-protocol: 2\n' "$(cat "$TOKEN")" > "$headers"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null -H @"$headers" "$BACKEND/api/projects"; then
      rm -f "$headers"
      return 0
    fi
    sleep 2
  done
  rm -f "$headers"
  return 1
}

serving() {
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "$BACKEND/" && return 0
    sleep 2
  done
  return 1
}

reset_and_seed() {
  echo "Resetting review state into $RESET_ARCHIVE"
  systemctl stop "$SERVICE"
  cp -a "$TOKEN" "$RESET_ARCHIVE.token"
  as_review mkdir -p "$RESET_ARCHIVE"
  for entry in "$STATE/userdata" "$STATE/worktrees" "$STATE/caches" "$WORKSPACE"; do
    if [ -e "$entry" ]; then as_review mv "$entry" "$RESET_ARCHIVE/"; fi
  done
  as_review mkdir -p "$STATE/userdata/secrets" "$WORKSPACE"
  as_review chmod 700 "$STATE/userdata/secrets"
  as_review cp -a "$RESET_ARCHIVE/userdata/secrets/." "$STATE/userdata/secrets/"
  systemctl start "$SERVICE"
  serving
  as_review "$ROOT/runtime/supaterm" auth session issue \
    --base-dir "$STATE" --label "Review access admin" --ttl 3650d --token-only > "$TOKEN.new"
  install -o review-access -g review-access -m 600 "$TOKEN.new" "$TOKEN"
  rm -f "$TOKEN.new"
  systemctl restart "$ACCESS_SERVICE"
  systemctl is-active --quiet "$ACCESS_SERVICE"
  as_review python3 -I "$ROOT/bin/seed-projects.py" "$WORKSPACE"
  timeout 45m node "$ROOT/bin/seed-threads.mjs" "$TOKEN"
}

restore() {
  trap - ERR
  set +e
  echo "Restoring Supaterm $current" >&2
  systemctl stop "$SERVICE"
  if [ -n "$RESET_ARCHIVE" ] && [ -d "$RESET_ARCHIVE" ]; then
    for name in userdata worktrees caches; do
      rm -rf "${STATE:?}/$name"
      if [ -e "$RESET_ARCHIVE/$name" ]; then mv "$RESET_ARCHIVE/$name" "$STATE/"; fi
    done
    rm -rf "$WORKSPACE"
    if [ -e "$RESET_ARCHIVE/workspace" ]; then mv "$RESET_ARCHIVE/workspace" "$WORKSPACE"; fi
    if [ -e "$RESET_ARCHIVE.token" ]; then
      install -o review-access -g review-access -m 600 "$RESET_ARCHIVE.token" "$TOKEN"
    fi
    systemctl restart "$ACCESS_SERVICE"
  fi
  if [ -d "$ROOT/runtime.prev" ]; then
    rm -rf "$ROOT/runtime.failed"
    if [ -d "$ROOT/runtime" ]; then mv "$ROOT/runtime" "$ROOT/runtime.failed"; fi
    mv "$ROOT/runtime.prev" "$ROOT/runtime"
  fi
  systemctl start "$SERVICE"
  if healthy; then echo "Restored Supaterm $current" >&2; else echo "Supaterm $current is unhealthy after restore" >&2; fi
  exit 1
}

latest=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  python3 -I -c 'import json, sys; print(json.load(sys.stdin)["tag_name"].removeprefix("v"))')
current=$("$ROOT/runtime/supaterm" --version | awk '{print $2}')
current=${current#v}

if [ "$latest" = "$current" ]; then
  if ! healthy; then
    echo "Supaterm $current is unhealthy; restarting"
    systemctl restart "$SERVICE"
    healthy
  fi
  echo "Supaterm $current is current"
  exit 0
fi

echo "Updating Supaterm $current -> $latest"
rm -rf "$STAGING"
mkdir -p "$STAGING"
archive="supaterm-$latest-linux-x64.tar.gz"
base="https://github.com/$REPO/releases/download/v$latest"
curl -fsSL "$base/$archive" -o "$STAGING/$archive"
curl -fsSL "$base/SHA256SUMS" -o "$STAGING/SHA256SUMS"
grep " $archive\$" "$STAGING/SHA256SUMS" | sed "s# $archive\$# $STAGING/$archive#" | sha256sum -c -
tar -xzf "$STAGING/$archive" -C "$STAGING"
candidate="$STAGING/supaterm-$latest-linux-x64"
chown -R root:root "$candidate"
"$candidate/supaterm" --version

trap restore ERR
systemctl stop "$SERVICE"
rm -rf "$ROOT/runtime.prev"
mv "$ROOT/runtime" "$ROOT/runtime.prev"
mv "$candidate" "$ROOT/runtime"
since=$(date '+%Y-%m-%d %H:%M:%S')
systemctl start "$SERVICE" || true

if ! healthy; then
  journalctl -u "$SERVICE" --since "$since" --no-pager | grep -q "different migration history" || restore
  RESET_ARCHIVE="$HOME_DIR/old-$(date +%Y%m%d-%H%M%S)"
  reset_and_seed
  healthy || restore
fi

trap - ERR
rm -rf "$ROOT/runtime.prev" "$STAGING"
echo "Updated to Supaterm $latest"
