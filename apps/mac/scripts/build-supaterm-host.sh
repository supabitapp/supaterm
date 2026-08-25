#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="${script_dir}/$(basename "${BASH_SOURCE[0]}")"
srcroot="${SRCROOT:-$(cd "${script_dir}/.." && pwd)}"
host_dir="${srcroot}/SupatermHost"
host_build_root="${srcroot}/.build/supaterm-host"
host_local_cache_dir="${host_build_root}/.zig-cache"
host_global_cache_dir="${host_build_root}/.zig-global-cache"
host_fingerprint_path="${host_build_root}/fingerprint"
host_binary_path="${host_build_root}/bin/supaterm-host"
host_target="aarch64-macos.26.0"
host_macos_minimum="26.0"
host_version="1.0.0"

validate_host_binary() {
  local binary_path="$1"
  local architectures
  local minos
  local smoke_dir
  local valid=0
  local version_output

  smoke_dir="$(mktemp -d /tmp/supaterm-host-smoke.XXXXXX)"
  architectures="$(lipo -archs "${binary_path}" 2>/dev/null || true)"
  minos="$(xcrun vtool -show-build "${binary_path}" 2>/dev/null | awk '$1 == "minos" { print $2 }' | sort -u)"
  version_output="$(SUPATERM_HOST_DIR="${smoke_dir}" "${binary_path}" version 2>/dev/null || true)"
  if [ "${architectures}" = "arm64" ] &&
    [ "${minos}" = "${host_macos_minimum}" ] &&
    grep -Fq "${host_version}" <<<"${version_output}" &&
    SUPATERM_HOST_DIR="${smoke_dir}" "${binary_path}" ls --short >/dev/null 2>&1 &&
    [ "$(stat -f '%Lp' "${smoke_dir}")" = "700" ] &&
    [ "$(stat -f '%Lp' "${smoke_dir}/logs")" = "700" ] &&
    [ "$(stat -f '%Lp' "${smoke_dir}/logs/supaterm-host.log")" = "600" ]; then
    valid=1
  fi
  find "${smoke_dir}" -depth -delete
  [ "${valid}" -eq 1 ]
}

print_fingerprint() {
  (
    cd "${srcroot}"
    {
      find SupatermHost -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256
      shasum -a 256 "${script_path}" | awk '{print $1}'
      mise exec -- zig version
      printf '%s\n' "${host_target}" "${host_version}"
    } | shasum -a 256 | awk '{print $1}'
  )
}

if [ "${1:-}" = "--print-fingerprint" ]; then
  print_fingerprint
  exit 0
fi

fingerprint="$(print_fingerprint)"

mkdir -p "${host_build_root}"

if [ -f "${host_fingerprint_path}" ] &&
  [ -x "${host_binary_path}" ] &&
  [ "$(<"${host_fingerprint_path}")" = "${fingerprint}" ]; then
  if validate_host_binary "${host_binary_path}"; then
    printf '%s\n' "Using cached supaterm-host build"
    exit 0
  fi
  printf '%s\n' "Cached supaterm-host build failed smoke test; rebuilding" >&2
fi

cd "${host_dir}"
mise exec -- zig build -Doptimize=ReleaseSafe -Dtarget="${host_target}" -Dversion="${host_version}" --prefix "${host_build_root}" --cache-dir "${host_local_cache_dir}" --global-cache-dir "${host_global_cache_dir}"

if [ ! -x "${host_binary_path}" ]; then
  echo "error: supaterm-host build produced no binary at ${host_binary_path}" >&2
  exit 1
fi

if ! validate_host_binary "${host_binary_path}"; then
  echo "error: supaterm-host build produced an unusable binary at ${host_binary_path}" >&2
  exit 1
fi

printf '%s\n' "${fingerprint}" > "${host_fingerprint_path}"
