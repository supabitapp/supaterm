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
host_remote_root="${host_build_root}/remote"
host_macos_minimum="26.0"
remote_macos_minimum="13.0"
host_version="1.0.0"
remote_platforms=("linux-x86_64" "linux-aarch64" "macos-x86_64" "macos-aarch64")
remote_targets=("x86_64-linux-musl" "aarch64-linux-musl" "x86_64-macos.13.0" "aarch64-macos.13.0")

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

validate_remote_binaries() {
  local index
  local binary_path
  local description
  local minos

  for index in "${!remote_platforms[@]}"; do
    binary_path="${host_remote_root}/${remote_platforms[$index]}/supaterm-host"
    [ -x "${binary_path}" ] || return 1
    description="$(file -b "${binary_path}")"
    case "${remote_platforms[$index]}" in
      linux-x86_64)
        grep -Fq "ELF 64-bit LSB executable, x86-64" <<<"${description}" || return 1
        grep -Fq "statically linked" <<<"${description}" || return 1
        ;;
      linux-aarch64)
        grep -Fq "ELF 64-bit LSB executable, ARM aarch64" <<<"${description}" || return 1
        grep -Fq "statically linked" <<<"${description}" || return 1
        ;;
      macos-x86_64)
        grep -Fq "Mach-O 64-bit executable x86_64" <<<"${description}" || return 1
        minos="$(xcrun vtool -show-build "${binary_path}" | awk '$1 == "minos" { print $2 }' | sort -u)"
        [ "${minos}" = "${remote_macos_minimum}" ] || return 1
        ;;
      macos-aarch64)
        grep -Fq "Mach-O 64-bit executable arm64" <<<"${description}" || return 1
        minos="$(xcrun vtool -show-build "${binary_path}" | awk '$1 == "minos" { print $2 }' | sort -u)"
        [ "${minos}" = "${remote_macos_minimum}" ] || return 1
        ;;
    esac
  done
}

print_fingerprint() {
  (
    cd "${srcroot}"
    {
      find SupatermHost -type f ! -path 'SupatermHost/zig-pkg/*' -print0 |
        LC_ALL=C sort -z |
        xargs -0 shasum -a 256
      shasum -a 256 "${script_path}" | awk '{print $1}'
      mise exec -- zig version
      printf '%s\n' "${host_target}" "${remote_targets[@]}" "${host_version}"
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
  if validate_host_binary "${host_binary_path}" && validate_remote_binaries; then
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

for index in "${!remote_platforms[@]}"; do
  platform="${remote_platforms[$index]}"
  target="${remote_targets[$index]}"
  prefix="${host_build_root}/targets/${platform}"
  binary_path="${prefix}/bin/supaterm-host"
  destination_dir="${host_remote_root}/${platform}"

  mise exec -- zig build \
    -Doptimize=ReleaseSafe \
    -Dtarget="${target}" \
    -Dversion="${host_version}" \
    --prefix "${prefix}" \
    --cache-dir "${host_local_cache_dir}-${platform}" \
    --global-cache-dir "${host_global_cache_dir}"
  mkdir -p "${destination_dir}"
  /usr/bin/install -m 755 "${binary_path}" "${destination_dir}/supaterm-host"
done

if ! validate_remote_binaries; then
  echo "error: supaterm-host remote builds are incomplete" >&2
  exit 1
fi

printf '%s\n' "${fingerprint}" > "${host_fingerprint_path}"
