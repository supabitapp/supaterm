#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
srcroot="$(cd "${script_dir}/.." && pwd)"

for package_dir in \
  "${srcroot}/ThirdParty/ghostty" \
  "${srcroot}/ThirdParty/zmx"; do
  expected_version="$(awk -F '"' '/minimum_zig_version/ { print $2 }' "${package_dir}/build.zig.zon")"
  actual_version="$("${script_dir}/zig-toolchain.sh" "${package_dir}" version)"

  if [ "${actual_version}" != "${expected_version}" ]; then
    printf '%s\n' "error: expected Zig ${expected_version} for ${package_dir}, got ${actual_version}" >&2
    exit 1
  fi
done
