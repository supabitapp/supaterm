#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
zmx_dir="$repo_root/ThirdParty/zmx"
patch_dir="$repo_root/patches"

if [ ! -d "$zmx_dir" ]; then
  echo "error: missing $zmx_dir" >&2
  exit 1
fi

if [ ! -d "$patch_dir" ]; then
  echo "error: missing $patch_dir" >&2
  exit 1
fi

patch_files=()
while IFS= read -r patch_file; do
  patch_files+=("$patch_file")
done < <(find "$patch_dir" -maxdepth 1 -type f -name 'zmx-*.patch' | sort)

if [ "${#patch_files[@]}" -eq 0 ]; then
  echo "error: no zmx patch files found in $patch_dir" >&2
  exit 1
fi

for patch_file in "${patch_files[@]}"; do
  if git -C "$zmx_dir" apply --check "$patch_file" >/dev/null 2>&1; then
    git -C "$zmx_dir" apply "$patch_file"
    continue
  fi

  if git -C "$zmx_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
    echo "zmx patch already applied: $(basename "$patch_file")"
    continue
  fi

  echo "error: unable to apply $patch_file cleanly" >&2
  exit 1
done
