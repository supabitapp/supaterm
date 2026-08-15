#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="${script_dir}/$(basename "${BASH_SOURCE[0]}")"
srcroot="${SRCROOT:-$(cd "${script_dir}/.." && pwd)}"
repo_root="$(cd "${srcroot}/../.." && pwd)"
host_dir="${repo_root}/apps/host"
host_manifest_path="${host_dir}/Cargo.toml"
project_xcconfig_path="${srcroot}/Configurations/Project.xcconfig"
ghostty_build_script_path="${srcroot}/scripts/build-ghostty.sh"
ghostty_vt_archive_path="${srcroot}/.build/ghostty/lib/libghostty-vt.a"
host_build_root="${srcroot}/.build/host"
host_cargo_target_dir="${host_build_root}/.cargo-target"
host_fingerprint_path="${host_build_root}/fingerprint"
host_binary_name="supaterm-host"
host_binary_path="${host_build_root}/bin/${host_binary_name}"
host_target="aarch64-apple-darwin"
host_macos_minimum="26.0"
host_built_binary_path="${host_cargo_target_dir}/${host_target}/release/${host_binary_name}"

ensure_host_source() {
  if [ ! -f "${host_manifest_path}" ]; then
    echo "error: missing ${host_manifest_path}" >&2
    exit 1
  fi
  if [ ! -f "${project_xcconfig_path}" ]; then
    echo "error: missing ${project_xcconfig_path}" >&2
    exit 1
  fi
  if [ ! -x "${ghostty_build_script_path}" ]; then
    echo "error: missing ${ghostty_build_script_path}" >&2
    exit 1
  fi
}

host_build_version() {
  local version

  version="$(sed -n 's/^MARKETING_VERSION *= *//p' "${project_xcconfig_path}")"
  if [ -z "${version}" ] || [[ "${version}" == *$'\n'* ]]; then
    echo "error: expected one MARKETING_VERSION in ${project_xcconfig_path}" >&2
    return 1
  fi
  printf '%s\n' "${version}"
}

validate_host_binary() {
  local binary_path="$1"
  local architectures
  local dependency
  local dependencies
  local expected_version
  local minos
  local valid=1
  local version_output

  architectures="$(lipo -archs "${binary_path}" 2>/dev/null || true)"
  minos="$(xcrun vtool -show-build "${binary_path}" 2>/dev/null | awk '$1 == "minos" { print $2 }' | sort -u)"
  expected_version="${host_binary_name} $(host_build_version)"
  version_output="$("${binary_path}" --version 2>/dev/null || true)"

  if [ "${architectures}" != "arm64" ]; then
    echo "error: host architectures are '${architectures}', expected 'arm64'" >&2
    valid=0
  fi
  if [ "${minos}" != "${host_macos_minimum}" ]; then
    echo "error: host deployment target is '${minos}', expected '${host_macos_minimum}'" >&2
    valid=0
  fi
  if [ "${version_output}" != "${expected_version}" ]; then
    echo "error: host version is '${version_output}', expected '${expected_version}'" >&2
    valid=0
  fi

  if ! dependencies="$(otool -L "${binary_path}" 2>/dev/null)"; then
    echo "error: host is not a valid Mach-O executable" >&2
    valid=0
  else
    while IFS= read -r dependency; do
      case "${dependency}" in
        /System/Library/* | /usr/lib/*)
          ;;
        *)
          echo "error: host has an unbundled dynamic dependency: ${dependency}" >&2
          valid=0
          ;;
      esac
    done < <(awk 'NR > 1 { print $1 }' <<< "${dependencies}")
  fi

  [ "${valid}" -eq 1 ]
}

print_fingerprint() {
  {
    git -C "${repo_root}" ls-files -s -- apps/host
    git -C "${repo_root}" diff --no-ext-diff --no-color HEAD -- apps/host
    while IFS= read -r untracked_path; do
      printf '%s\n' "${untracked_path}"
      shasum -a 256 "${repo_root}/${untracked_path}"
    done < <(git -C "${repo_root}" ls-files --others --exclude-standard -- apps/host | LC_ALL=C sort)
    shasum -a 256 "${script_path}" | awk '{print $1}'
    shasum -a 256 "${project_xcconfig_path}" | awk '{print $1}'
    "${ghostty_build_script_path}" --print-fingerprint
    mise exec -- rustc --version
    mise exec -- cargo --version
    xcodebuild -version
    xcrun --sdk macosx --show-sdk-version
    printf '%s\n' "${host_target}" "${host_macos_minimum}"
  } | shasum -a 256 | awk '{print $1}'
}

ensure_host_source

if [ "${1:-}" = "--print-fingerprint" ]; then
  print_fingerprint
  exit 0
fi

fingerprint="$(print_fingerprint)"

"${ghostty_build_script_path}"
if [ ! -f "${ghostty_vt_archive_path}" ]; then
  echo "error: missing ${ghostty_vt_archive_path}" >&2
  exit 1
fi
if [ "$(lipo -archs "${ghostty_vt_archive_path}" 2>/dev/null || true)" != "arm64" ]; then
  echo "error: ${ghostty_vt_archive_path} is not arm64" >&2
  exit 1
fi

mkdir -p "${host_build_root}"

if [ -f "${host_fingerprint_path}" ] &&
  [ -x "${host_binary_path}" ] &&
  [ "$(cat "${host_fingerprint_path}")" = "${fingerprint}" ]; then
  if validate_host_binary "${host_binary_path}"; then
    printf '%s\n' "Using cached host build"
    exit 0
  fi
  printf '%s\n' "Cached host build failed smoke test; rebuilding" >&2
fi

cd "${host_dir}"
MACOSX_DEPLOYMENT_TARGET="${host_macos_minimum}" \
  SUPATERM_GHOSTTY_VT_LIB_DIR="$(dirname "${ghostty_vt_archive_path}")" \
  SUPATERM_BUILD_VERSION="$(host_build_version)" \
  mise exec -- cargo build \
  --release \
  --locked \
  --target "${host_target}" \
  --target-dir "${host_cargo_target_dir}" \
  --bin "${host_binary_name}"

if [ ! -x "${host_built_binary_path}" ]; then
  echo "error: host build produced no executable at ${host_built_binary_path}" >&2
  exit 1
fi

mkdir -p "$(dirname "${host_binary_path}")"
/bin/cp -f "${host_built_binary_path}" "${host_binary_path}"

if ! validate_host_binary "${host_binary_path}"; then
  echo "error: host build produced an unusable binary at ${host_binary_path}" >&2
  exit 1
fi

printf '%s\n' "${fingerprint}" > "${host_fingerprint_path}"
