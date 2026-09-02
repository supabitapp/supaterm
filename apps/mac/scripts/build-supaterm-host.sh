#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="${script_dir}/$(basename "${BASH_SOURCE[0]}")"
srcroot="${SRCROOT:-$(cd "${script_dir}/.." && pwd)}"
repo_root="$(cd "${srcroot}/../.." && pwd)"
host_dir="${repo_root}/apps/supaterm-host"
host_manifest_path="${host_dir}/Cargo.toml"
version_xcconfig_path="${repo_root}/apps/Configurations/Versions.xcconfig"
ghostty_build_script_path="${srcroot}/scripts/build-ghostty.sh"
ghostty_vt_archive_path="${srcroot}/.build/ghostty/lib/libghostty-vt.a"
ghostty_vt_anchor_symbol="_ghostty_terminal_new"
host_build_root="${srcroot}/.build/supaterm-host"
host_build_lock_path="${host_build_root}/build.lock"
host_cargo_target_dir="${host_build_root}/.cargo-target"
host_fingerprint_path="${host_build_root}/fingerprint"
host_binary_path="${host_build_root}/bin/supaterm-host"
sp_binary_path="${host_build_root}/bin/sp"
host_target="aarch64-apple-darwin"
macos_minimum="26.0"

if [ "${SUPATERM_HOST_BUILD_LOCKED:-}" != "${host_build_lock_path}" ]; then
  mkdir -p "${host_build_root}"
  export SUPATERM_HOST_BUILD_LOCKED="${host_build_lock_path}"
  exec /usr/bin/lockf -k "${host_build_lock_path}" "${script_path}" "$@"
fi

ensure_inputs() {
  if [ ! -f "${host_manifest_path}" ]; then
    echo "error: missing ${host_manifest_path}" >&2
    exit 1
  fi
  if [ ! -f "${version_xcconfig_path}" ]; then
    echo "error: missing ${version_xcconfig_path}" >&2
    exit 1
  fi
  if [ ! -x "${ghostty_build_script_path}" ]; then
    echo "error: missing ${ghostty_build_script_path}" >&2
    exit 1
  fi
}

host_build_version() {
  local version

  version="$(sed -n 's/^MARKETING_VERSION *= *//p' "${version_xcconfig_path}")"
  if [ -z "${version}" ] || [[ "${version}" == *$'\n'* ]]; then
    echo "error: expected one MARKETING_VERSION in ${version_xcconfig_path}" >&2
    return 1
  fi
  printf '%s\n' "${version}"
}

hash_source_paths() {
  git -C "${repo_root}" ls-files -s -- "$@"
  git -C "${repo_root}" diff --no-ext-diff --no-color HEAD -- "$@"
  while IFS= read -r untracked_path; do
    printf '%s\n' "${untracked_path}"
    shasum -a 256 "${repo_root}/${untracked_path}" | awk '{print $1}'
  done < <(git -C "${repo_root}" ls-files --others --exclude-standard -- "$@" | LC_ALL=C sort)
}

print_fingerprint() {
  {
    hash_source_paths \
      apps/supaterm-host \
      ':(exclude)apps/supaterm-host/target'
    shasum -a 256 "${script_path}" "${version_xcconfig_path}" "${repo_root}/mise.toml" | awk '{print $1}'
    "${ghostty_build_script_path}" --print-fingerprint
    mise exec -- rustc --version
    mise exec -- cargo --version
    xcodebuild -version
    xcrun --sdk macosx --show-sdk-version
    printf '%s\n' "${host_target}" "${macos_minimum}"
  } | shasum -a 256 | awk '{print $1}'
}

validate_binary_shape() {
  local binary_path="$1"
  local architectures
  local dependency
  local dependencies
  local minos
  local permissions
  local valid=1

  architectures="$(lipo -archs "${binary_path}" 2>/dev/null || true)"
  minos="$(xcrun vtool -show-build "${binary_path}" 2>/dev/null | awk '$1 == "minos" { print $2 }' | sort -u)"
  permissions="$(stat -f '%Lp' "${binary_path}" 2>/dev/null || true)"

  if [ ! -f "${binary_path}" ] || [ -L "${binary_path}" ]; then
    echo "error: ${binary_path} is not a regular unlinked file" >&2
    valid=0
  fi
  if [ "${architectures}" != "arm64" ]; then
    echo "error: ${binary_path} architectures are '${architectures}', expected 'arm64'" >&2
    valid=0
  fi
  if [ "${minos}" != "${macos_minimum}" ]; then
    echo "error: ${binary_path} deployment target is '${minos}', expected '${macos_minimum}'" >&2
    valid=0
  fi
  if [ "${permissions}" != "755" ]; then
    echo "error: ${binary_path} permissions are '${permissions}', expected '755'" >&2
    valid=0
  fi

  if ! dependencies="$(otool -L "${binary_path}" 2>/dev/null)"; then
    echo "error: ${binary_path} is not a valid Mach-O executable" >&2
    valid=0
  else
    while IFS= read -r dependency; do
      case "${dependency}" in
        /System/Library/* | /usr/lib/*)
          ;;
        *)
          echo "error: ${binary_path} has an unbundled dynamic dependency: ${dependency}" >&2
          valid=0
          ;;
      esac
    done < <(awk 'NR > 1 { print $1 }' <<< "${dependencies}")
  fi

  [ "${valid}" -eq 1 ]
}

binary_has_global_symbol() {
  nm -gU "$1" 2>/dev/null |
    awk -v symbol="$2" '$NF == symbol { found = 1 } END { exit(found ? 0 : 1) }'
}

run_with_timeout() {
  local seconds="$1"
  shift
  /usr/bin/perl -e '
    my $seconds = shift @ARGV;
    alarm $seconds;
    exec @ARGV or die "exec failed: $!\n";
  ' "${seconds}" "$@"
}

terminate_process() {
  local pid="$1"

  if kill -0 "${pid}" 2>/dev/null; then
    if kill -TERM "${pid}" 2>/dev/null; then
      for _ in {1..50}; do
        if ! kill -0 "${pid}" 2>/dev/null; then
          break
        fi
        sleep 0.02
      done
    fi
    if kill -0 "${pid}" 2>/dev/null; then
      if kill -KILL "${pid}" 2>/dev/null; then
        :
      fi
    fi
  fi
  if wait "${pid}" 2>/dev/null; then
    :
  fi
}

cleanup_transport_smoke() {
  local host_pid="$1"
  local smoke_dir="$2"

  if [ -n "${host_pid}" ]; then
    terminate_process "${host_pid}"
  fi
  if [ -n "${smoke_dir}" ]; then
    rm -rf "${smoke_dir}"
  fi
}

transport_host_identity() {
  local expected_pid="$1"
  local runtime_record_path="$2"
  local expected_build_identity="$3"
  local recorded_build_identity
  local recorded_pid

  if ! kill -0 "${expected_pid}" 2>/dev/null || [ ! -f "${runtime_record_path}" ]; then
    return 1
  fi
  recorded_pid="$(plutil -extract pid raw -o - "${runtime_record_path}" 2>/dev/null)"
  if [ "${recorded_pid}" != "${expected_pid}" ]; then
    return 1
  fi
  recorded_build_identity="$(plutil -extract build_identity raw -o - "${runtime_record_path}" 2>/dev/null)"
  if [ "${recorded_build_identity}" != "${expected_build_identity}" ]; then
    return 1
  fi
  shasum -a 256 "${runtime_record_path}" | awk '{ print $1 }'
}

transport_host_identity_matches() {
  local actual_identity

  if ! actual_identity="$(transport_host_identity "$1" "$2" "$4")"; then
    return 1
  fi
  [ "${actual_identity}" = "$3" ]
}

validate_transport_smoke() {
  local smoke_host_binary_path="$1"
  local smoke_sp_binary_path="$2"
  local expected_build_identity="$3"
  local expected_host_identity
  local host_pid=""
  local runtime_record_path
  local smoke_dir=""
  local socket_path
  local valid=1

  trap 'cleanup_transport_smoke "${host_pid:-}" "${smoke_dir:-}"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  smoke_dir="$(mktemp -d /tmp/supaterm-host-smoke.XXXXXX)"
  socket_path="${smoke_dir}/host.sock"
  runtime_record_path="${socket_path}.json"
  "${smoke_host_binary_path}" serve --socket "${socket_path}" --foreground \
    >"${smoke_dir}/stdout" 2>"${smoke_dir}/stderr" &
  host_pid=$!

  for _ in {1..150}; do
    if { [ -S "${socket_path}" ] && [ -f "${runtime_record_path}" ]; } ||
      ! kill -0 "${host_pid}" 2>/dev/null; then
      break
    fi
    sleep 0.02
  done

  if ! expected_host_identity="$(transport_host_identity \
    "${host_pid}" "${runtime_record_path}" "${expected_build_identity}")"; then
    echo "error: staged supaterm-host did not create its runtime identity" >&2
    valid=0
  elif ! run_with_timeout 5 "${smoke_sp_binary_path}" --connect-only --socket "${socket_path}" ping >/dev/null; then
    echo "error: staged sp could not connect to supaterm-host" >&2
    valid=0
  elif ! transport_host_identity_matches \
    "${host_pid}" "${runtime_record_path}" "${expected_host_identity}" \
    "${expected_build_identity}"; then
    echo "error: staged sp replaced supaterm-host during ping" >&2
    valid=0
  elif ! run_with_timeout 5 "${smoke_sp_binary_path}" --connect-only --socket "${socket_path}" snapshot >/dev/null; then
    echo "error: staged sp could not read a host snapshot" >&2
    valid=0
  elif ! transport_host_identity_matches \
    "${host_pid}" "${runtime_record_path}" "${expected_host_identity}" \
    "${expected_build_identity}"; then
    echo "error: staged sp replaced supaterm-host during snapshot" >&2
    valid=0
  fi

  if ! run_with_timeout 5 "${smoke_sp_binary_path}" --connect-only --socket "${socket_path}" shutdown >/dev/null; then
    echo "error: staged sp could not shut down supaterm-host" >&2
    valid=0
  fi

  for _ in {1..150}; do
    if ! kill -0 "${host_pid}" 2>/dev/null; then
      break
    fi
    sleep 0.02
  done

  if kill -0 "${host_pid}" 2>/dev/null; then
    echo "error: staged supaterm-host did not shut down" >&2
    valid=0
  else
    if ! wait "${host_pid}"; then
      echo "error: staged supaterm-host exited with an error" >&2
      valid=0
    fi
    host_pid=""
  fi
  if [ -e "${socket_path}" ]; then
    echo "error: staged supaterm-host left its socket behind" >&2
    valid=0
  fi

  cleanup_transport_smoke "${host_pid}" "${smoke_dir}"
  host_pid=""
  smoke_dir=""
  trap - EXIT INT TERM
  [ "${valid}" -eq 1 ]
}

validate_outputs() {
  local checked_host_binary_path="$1"
  local checked_sp_binary_path="$2"
  local expected_build_identity="$3"
  local expected_host_version
  local host_version
  local sp_help
  local valid=1

  if [ ! -x "${checked_host_binary_path}" ] || ! validate_binary_shape "${checked_host_binary_path}"; then
    valid=0
  fi
  if [ ! -x "${checked_sp_binary_path}" ] || ! validate_binary_shape "${checked_sp_binary_path}"; then
    valid=0
  fi
  if ! binary_has_global_symbol "${checked_host_binary_path}" "${ghostty_vt_anchor_symbol}"; then
    echo "error: ${checked_host_binary_path} does not contain ${ghostty_vt_anchor_symbol}" >&2
    valid=0
  fi
  if binary_has_global_symbol "${checked_sp_binary_path}" "${ghostty_vt_anchor_symbol}"; then
    echo "error: ${checked_sp_binary_path} contains host-only ${ghostty_vt_anchor_symbol}" >&2
    valid=0
  fi

  expected_host_version="supaterm-host $(host_build_version)"
  if ! host_version="$("${checked_host_binary_path}" version 2>/dev/null)"; then
    echo "error: ${checked_host_binary_path} version failed" >&2
    valid=0
  elif [ "${host_version}" != "${expected_host_version}" ]; then
    echo "error: ${checked_host_binary_path} version is '${host_version}', expected '${expected_host_version}'" >&2
    valid=0
  fi
  if ! sp_help="$("${checked_sp_binary_path}" --help 2>/dev/null)"; then
    echo "error: ${checked_sp_binary_path} help failed" >&2
    valid=0
  elif [[ "${sp_help}" != Usage:* ]]; then
    echo "error: ${checked_sp_binary_path} returned invalid help" >&2
    valid=0
  fi
  if ! validate_transport_smoke \
    "${checked_host_binary_path}" "${checked_sp_binary_path}" "${expected_build_identity}"; then
    valid=0
  fi

  [ "${valid}" -eq 1 ]
}

ensure_inputs

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
if [ "$(lipo -archs "${ghostty_vt_archive_path}" 2>/dev/null || true)" != "arm64" ] ||
  ! xcrun ar -t "${ghostty_vt_archive_path}" >/dev/null 2>&1; then
  echo "error: ${ghostty_vt_archive_path} is not a valid arm64 archive" >&2
  exit 1
fi

mkdir -p "${host_build_root}"

if [ -f "${host_fingerprint_path}" ] &&
  [ "$(cat "${host_fingerprint_path}")" = "${fingerprint}" ]; then
  if validate_outputs "${host_binary_path}" "${sp_binary_path}" "${fingerprint}"; then
    printf '%s\n' "Using cached supaterm-host build"
    exit 0
  fi
  printf '%s\n' "Cached supaterm-host build failed smoke test; rebuilding" >&2
fi

rm -f "${host_fingerprint_path}"

cd "${host_dir}"
MACOSX_DEPLOYMENT_TARGET="${macos_minimum}" \
  SUPATERM_BUILD_VERSION="$(host_build_version)" \
  SUPATERM_BUILD_IDENTITY="${fingerprint}" \
  mise exec -- cargo build \
  --release \
  --locked \
  --target "${host_target}" \
  --target-dir "${host_cargo_target_dir}" \
  --bin sp
MACOSX_DEPLOYMENT_TARGET="${macos_minimum}" \
  SUPATERM_BUILD_VERSION="$(host_build_version)" \
  SUPATERM_BUILD_IDENTITY="${fingerprint}" \
  SUPATERM_GHOSTTY_VT_ARCHIVE="${ghostty_vt_archive_path}" \
  mise exec -- cargo build \
  --release \
  --locked \
  --target "${host_target}" \
  --target-dir "${host_cargo_target_dir}" \
  --bin supaterm-host

host_pending_binary_path="${host_build_root}/bin/.supaterm-host.pending"
sp_pending_binary_path="${host_build_root}/bin/.sp.pending"
fingerprint_pending_path="${host_fingerprint_path}.pending"
mkdir -p "${host_build_root}/bin"
rm -f "${host_pending_binary_path}" "${sp_pending_binary_path}" "${fingerprint_pending_path}"
/usr/bin/install -m 755 \
  "${host_cargo_target_dir}/${host_target}/release/supaterm-host" \
  "${host_pending_binary_path}"
/usr/bin/install -m 755 \
  "${host_cargo_target_dir}/${host_target}/release/sp" \
  "${sp_pending_binary_path}"

if ! validate_outputs \
  "${host_pending_binary_path}" "${sp_pending_binary_path}" "${fingerprint}"; then
  rm -f "${host_pending_binary_path}" "${sp_pending_binary_path}"
  echo "error: supaterm-host build produced unusable outputs" >&2
  exit 1
fi

mv -f "${host_pending_binary_path}" "${host_binary_path}"
mv -f "${sp_pending_binary_path}" "${sp_binary_path}"
if ! validate_outputs "${host_binary_path}" "${sp_binary_path}" "${fingerprint}"; then
  echo "error: published supaterm-host outputs failed validation" >&2
  exit 1
fi
printf '%s\n' "${fingerprint}" > "${fingerprint_pending_path}"
mv -f "${fingerprint_pending_path}" "${host_fingerprint_path}"
