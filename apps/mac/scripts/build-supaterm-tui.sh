#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
script_path="${script_dir}/$(basename "${BASH_SOURCE[0]}")"
srcroot="${SRCROOT:-$(cd "${script_dir}/.." && pwd)}"
supaterm_tui_dir="${srcroot}/SupatermTUI"
supaterm_tui_build_root="${srcroot}/.build/supaterm-tui"
supaterm_tui_cargo_target_dir="${supaterm_tui_build_root}/.cargo-target"
supaterm_tui_fingerprint_path="${supaterm_tui_build_root}/fingerprint"
supaterm_tui_binary_path="${supaterm_tui_build_root}/bin/supaterm"
target="aarch64-apple-darwin"

validate_supaterm_tui_binary() {
  "$1" --help >/dev/null 2>&1
}

print_fingerprint() {
  (
    cd "${supaterm_tui_dir}"
    {
      while IFS= read -r file; do
        shasum -a 256 "${file}"
      done < <(find Cargo.toml Cargo.lock build.rs agent-icons.tsv src -type f -print | LC_ALL=C sort)
      while IFS=$'\t' read -r agent name source; do
        if [ -z "${agent}" ] || [ -z "${name}" ] || [ -z "${source}" ]; then
          echo "error: invalid agent-icons.tsv" >&2
          exit 1
        fi
        shasum -a 256 "${source}"
      done < agent-icons.tsv
      shasum -a 256 "${script_path}" | awk '{print $1}'
      mise exec -- rustc --version
      mise exec -- cargo --version
      printf '%s\n' "${target}"
    } | shasum -a 256 | awk '{print $1}'
  )
}

if [ ! -f "${supaterm_tui_dir}/Cargo.toml" ]; then
  echo "error: missing ${supaterm_tui_dir}/Cargo.toml" >&2
  exit 1
fi

if [ "${1:-}" = "--print-fingerprint" ]; then
  print_fingerprint
  exit 0
fi

fingerprint="$(print_fingerprint)"

mkdir -p "${supaterm_tui_build_root}"

if [ -f "${supaterm_tui_fingerprint_path}" ] &&
  [ -x "${supaterm_tui_binary_path}" ] &&
  [ "$(cat "${supaterm_tui_fingerprint_path}")" = "${fingerprint}" ]; then
  if validate_supaterm_tui_binary "${supaterm_tui_binary_path}"; then
    printf '%s\n' "Using cached Supaterm TUI build"
    exit 0
  fi
  printf '%s\n' "Cached Supaterm TUI build failed smoke test; rebuilding" >&2
fi

cd "${supaterm_tui_dir}"
mise exec -- cargo build --release --locked --target "${target}" --target-dir "${supaterm_tui_cargo_target_dir}"

mkdir -p "$(dirname "${supaterm_tui_binary_path}")"
supaterm_tui_binary_tmp="$(mktemp "${supaterm_tui_binary_path}.XXXXXX")"
trap 'rm -f "${supaterm_tui_binary_tmp}"' EXIT
/bin/cp -f "${supaterm_tui_cargo_target_dir}/${target}/release/supaterm" "${supaterm_tui_binary_tmp}"
/bin/chmod 755 "${supaterm_tui_binary_tmp}"
if ! validate_supaterm_tui_binary "${supaterm_tui_binary_tmp}"; then
  echo "error: Supaterm TUI build produced an unusable binary" >&2
  exit 1
fi
/bin/mv -f "${supaterm_tui_binary_tmp}" "${supaterm_tui_binary_path}"
trap - EXIT

printf '%s\n' "${fingerprint}" > "${supaterm_tui_fingerprint_path}"
