#!/usr/bin/env bash
set -euo pipefail

package_dir="$1"
shift

zig_version="$(
  sed -nE 's/^[[:space:]]*\.minimum_zig_version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' \
    "${package_dir}/build.zig.zon"
)"

case "${zig_version}" in
  ""|*$'\n'*)
    printf '%s\n' "error: expected one minimum_zig_version in ${package_dir}/build.zig.zon" >&2
    exit 1
    ;;
esac

zig_dir="$(mise where "zig@${zig_version}")"
exec "${zig_dir}/bin/zig" "$@"
