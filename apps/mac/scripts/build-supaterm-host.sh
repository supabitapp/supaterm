#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="${script_dir}/$(basename "${BASH_SOURCE[0]}")"
srcroot="${SRCROOT:-$(cd "${script_dir}/.." && pwd)}"
repo_root="$(cd "${srcroot}/../.." && pwd)"
host_dir="${repo_root}/apps/supaterm-host"
ghostty_dir="${srcroot}/ThirdParty/ghostty"
build_root="${srcroot}/.build/supaterm-host"
cargo_target_dir="${build_root}/cargo-target"
vt_prefix="${build_root}/ghostty-vt"
fingerprint_path="${build_root}/fingerprint"
host_binary="${build_root}/bin/supaterm-host"
sp_binary="${build_root}/bin/sp"
rust_target="aarch64-apple-darwin"
zig_target="aarch64-macos.26.0"

print_fingerprint() {
  (
    cd "${repo_root}"
    {
      find apps/supaterm-host integrations/supaterm -type f \
        ! -path '*/target/*' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256
      git -C "${ghostty_dir}" rev-parse HEAD
      git -C "${ghostty_dir}" diff --no-ext-diff --no-color HEAD -- . | shasum -a 256
      shasum -a 256 "${script_path}" | awk '{print $1}'
      mise exec -- rustc --version
      mise exec -- cargo --version
      mise exec -- zig version
      printf '%s\n' "${rust_target}" "${zig_target}"
      printf '%s\n' "${MARKETING_VERSION:-0.1.0}" "${SUPATERM_RELEASE_DATE:-}"
    } | shasum -a 256 | awk '{print $1}'
  )
}

validate_binary() {
  local binary="$1"
  local command="$2"
  local architectures
  local minos
  architectures="$(lipo -archs "${binary}" 2>/dev/null || true)"
  minos="$(xcrun vtool -show-build "${binary}" 2>/dev/null | awk '$1 == "minos" { print $2 }' | sort -u)"
  [ "${architectures}" = "arm64" ] &&
    [ "${minos}" = "26.0" ] &&
    "${binary}" "${command}" >/dev/null
}

if [ "${1:-}" = "--print-fingerprint" ]; then
  print_fingerprint
  exit 0
fi

fingerprint="$(print_fingerprint)"
mkdir -p "${build_root}"

if [ -f "${fingerprint_path}" ] &&
  [ "$(cat "${fingerprint_path}")" = "${fingerprint}" ] &&
  [ -x "${host_binary}" ] &&
  [ -x "${sp_binary}" ] &&
  validate_binary "${host_binary}" version &&
  validate_binary "${sp_binary}" version; then
  printf '%s\n' "Using cached supaterm-host build"
  exit 0
fi

mise exec -- zig build \
  --build-file "${ghostty_dir}/build.zig" \
  -Demit-lib-vt=true \
  -Demit-macos-app=false \
  -Demit-xcframework=false \
  -Doptimize=ReleaseFast \
  -Dtarget="${zig_target}" \
  --prefix "${vt_prefix}"

cd "${host_dir}"
MACOSX_DEPLOYMENT_TARGET=26.0 \
SUPATERM_GHOSTTY_VT_LIB_DIR="${vt_prefix}/lib" \
SUPATERM_HOST_BUILD_FINGERPRINT="${fingerprint}" \
SUPATERM_HOST_APP_VERSION="${MARKETING_VERSION:-0.1.0}" \
SUPATERM_RELEASE_DATE="${SUPATERM_RELEASE_DATE:-}" \
  mise exec -- cargo build \
  --release \
  --locked \
  --target "${rust_target}" \
  --target-dir "${cargo_target_dir}" \
  --bins

mkdir -p "${build_root}/bin"
/usr/bin/install -m 755 "${cargo_target_dir}/${rust_target}/release/supaterm-host" "${host_binary}"
/usr/bin/install -m 755 "${cargo_target_dir}/${rust_target}/release/sp" "${sp_binary}"

if ! validate_binary "${host_binary}" version || ! validate_binary "${sp_binary}" version; then
  echo "error: supaterm-host build produced invalid executables" >&2
  exit 1
fi

printf '%s\n' "${fingerprint}" > "${fingerprint_path}"
