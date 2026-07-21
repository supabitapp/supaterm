#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="${script_dir}/$(basename "${BASH_SOURCE[0]}")"
srcroot="${SRCROOT:-$(cd "${script_dir}/.." && pwd)}"
repo_root="$(cd "${srcroot}/../.." && pwd)"
ap_dir="${srcroot}/ThirdParty/coding-agents-session-picker"
ap_submodule_path="${ap_dir#"${repo_root}/"}"
ap_build_root="${srcroot}/.build/ap"
ap_cargo_target_dir="${ap_build_root}/.cargo-target"
ap_fingerprint_path="${ap_build_root}/fingerprint"
ap_binary_path="${ap_build_root}/bin/ap"

validate_ap_binary() {
  "$1" --help >/dev/null 2>&1
}

print_fingerprint() {
  (
    cd "${ap_dir}"
    {
      git rev-parse HEAD
      git diff --no-ext-diff --no-color HEAD -- . | shasum -a 256
      git ls-files --others --exclude-standard | LC_ALL=C sort | shasum -a 256
      shasum -a 256 "${script_path}" | awk '{print $1}'
      shasum -a 256 "${srcroot}/../../mise.toml" | awk '{print $1}'
    } | shasum -a 256 | awk '{print $1}'
  )
}

ensure_ap_checkout() {
  if [ -f "${ap_dir}/Cargo.toml" ]; then
    return
  fi

  git -C "${repo_root}" submodule sync --recursive -- "${ap_submodule_path}"
  git -C "${repo_root}" submodule update --init --recursive -- "${ap_submodule_path}"

  if [ ! -f "${ap_dir}/Cargo.toml" ]; then
    echo "error: missing ${ap_dir} after submodule update" >&2
    exit 1
  fi
}

ensure_ap_checkout

if [ "${1:-}" = "--print-fingerprint" ]; then
  print_fingerprint
  exit 0
fi

fingerprint="$(print_fingerprint)"

mkdir -p "${ap_build_root}"

if [ -f "${ap_fingerprint_path}" ] &&
  [ -x "${ap_binary_path}" ] &&
  [ "$(cat "${ap_fingerprint_path}")" = "${fingerprint}" ]; then
  if validate_ap_binary "${ap_binary_path}"; then
    printf '%s\n' "Using cached ap build"
    exit 0
  fi
  printf '%s\n' "Cached ap build failed smoke test; rebuilding" >&2
fi

cd "${ap_dir}"
mise exec -- cargo build --release --locked --target-dir "${ap_cargo_target_dir}"

mkdir -p "$(dirname "${ap_binary_path}")"
/bin/cp -f "${ap_cargo_target_dir}/release/ap" "${ap_binary_path}"

if ! validate_ap_binary "${ap_binary_path}"; then
  echo "error: ap build produced an unusable binary at ${ap_binary_path}" >&2
  exit 1
fi

printf '%s\n' "${fingerprint}" > "${ap_fingerprint_path}"
