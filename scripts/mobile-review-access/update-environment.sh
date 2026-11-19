#!/usr/bin/env bash
# Keeps the app review VM on the latest stable Supaterm release. Run by supacode-review-update.timer as root.
set -euo pipefail

ROOT=/opt/supacode-review
HOME_DIR=/srv/supacode-review
STATE="$HOME_DIR/state"
WORKSPACE="$HOME_DIR/workspace"
TOKEN=/var/lib/supacode-review-access/admin.token
BACKEND=http://127.0.0.1:3773
REPO=supabitapp/supaterm
SERVICE=supacode-review
ACCESS_SERVICE=supacode-review-access

as_review() { sudo -u review env HOME="$HOME_DIR" "$@"; }

healthy() {
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null \
      -H "Authorization: Bearer $(cat "$TOKEN")" \
      -H "x-supaterm-orchestration-protocol: 2" \
      "$BACKEND/api/projects"; then
      return 0
    fi
    sleep 2
  done
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
  local archive
  archive="$HOME_DIR/old-$(date +%Y%m%d-%H%M%S)"
  echo "Resetting review state into $archive"
  systemctl stop "$SERVICE"
  as_review mkdir -p "$archive"
  for entry in "$STATE/userdata" "$STATE/worktrees" "$STATE/caches" "$WORKSPACE"; do
    if [ -e "$entry" ]; then as_review mv "$entry" "$archive/"; fi
  done
  as_review mkdir -p "$STATE/userdata/secrets" "$WORKSPACE"
  as_review chmod 700 "$STATE/userdata/secrets"
  as_review cp -a "$archive/userdata/secrets/." "$STATE/userdata/secrets/"
  systemctl start "$SERVICE"
  serving
  (cd /tmp && as_review "$ROOT/runtime/supaterm" auth session issue \
    --base-dir "$STATE" --label "Review access admin" --ttl 3650d --token-only) > "$TOKEN.new"
  install -o review-access -g review-access -m 600 "$TOKEN.new" "$TOKEN"
  rm -f "$TOKEN.new"
  systemctl restart "$ACCESS_SERVICE"
  (cd /tmp && as_review python3 -I "$ROOT/bin/seed-projects.py" "$WORKSPACE")
  (cd /tmp && node "$ROOT/bin/seed-threads.mjs" "$TOKEN")
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
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
archive="supaterm-$latest-linux-x64.tar.gz"
base="https://github.com/$REPO/releases/download/v$latest"
curl -fsSL "$base/$archive" -o "$work/$archive"
curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS"
(cd "$work" && grep " $archive\$" SHA256SUMS | sha256sum -c -)
tar -xzf "$work/$archive" -C "$work"
chown -R root:root "$work/supaterm-$latest-linux-x64"

systemctl stop "$SERVICE"
rm -rf "$ROOT/runtime.prev"
mv "$ROOT/runtime" "$ROOT/runtime.prev"
mv "$work/supaterm-$latest-linux-x64" "$ROOT/runtime"
since=$(date '+%Y-%m-%d %H:%M:%S')
systemctl start "$SERVICE"

if healthy; then
  echo "Updated to Supaterm $latest"
  exit 0
fi

if journalctl -u "$SERVICE" --since "$since" --no-pager | grep -q "different migration history"; then
  if reset_and_seed && healthy; then
    echo "Updated to Supaterm $latest with fresh example data"
    exit 0
  fi
fi

echo "Supaterm $latest failed its health check; rolling back to $current" >&2
systemctl stop "$SERVICE"
rm -rf "$ROOT/runtime.failed"
mv "$ROOT/runtime" "$ROOT/runtime.failed"
mv "$ROOT/runtime.prev" "$ROOT/runtime"
systemctl start "$SERVICE"
exit 1
