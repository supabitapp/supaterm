#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <lobe-icons|lucide|simple-icons> <icon-name> [icon-name ...]" >&2
  exit 64
fi

icon_source="$1"
shift

case "${icon_source}" in
  lobe-icons)
    base_url="https://unpkg.com/@lobehub/icons-static-svg@${LOBE_ICONS_VERSION:-1.94.0}/icons"
    asset_suffix="-mark"
    ;;
  lucide)
    base_url="https://unpkg.com/lucide-static@${LUCIDE_ICON_VERSION:-latest}/icons"
    asset_suffix=""
    ;;
  simple-icons)
    base_url="https://unpkg.com/simple-icons@${SIMPLE_ICONS_VERSION:-latest}/icons"
    asset_suffix=""
    ;;
  *)
    echo "error: unknown icon source: ${icon_source}" >&2
    exit 64
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
srcroot="$(cd "${script_dir}/.." && pwd)"
asset_root="${srcroot}/supaterm/Assets.xcassets"
tmp=""
tmp_filtered=""

trap 'rm -f "${tmp}" "${tmp_filtered}"' EXIT

for icon_name in "$@"; do
  case "${icon_name}" in
    "" | *[!a-z0-9-]*)
      echo "error: invalid icon name: ${icon_name}" >&2
      exit 64
      ;;
  esac

  asset_name="${icon_name}${asset_suffix}"
  imageset_dir="${asset_root}/${asset_name}.imageset"
  svg_path="${imageset_dir}/${asset_name}.svg"
  contents_path="${imageset_dir}/Contents.json"
  tmp="$(mktemp)"
  tmp_filtered="$(mktemp)"

  curl -fsSL "${base_url}/${icon_name}.svg" -o "${tmp}"

  case "${icon_source}" in
    lobe-icons)
      if ! grep -q '<title>' "${tmp}" || ! grep -q 'fill="currentColor"' "${tmp}"; then
        echo "error: fetched SVG does not look like ${icon_name}" >&2
        exit 65
      fi
      cp "${tmp}" "${tmp_filtered}"
      ;;
    lucide)
      awk '!/^<!-- @license /' "${tmp}" > "${tmp_filtered}"
      if ! grep -q "lucide-${icon_name}" "${tmp_filtered}"; then
        echo "error: fetched SVG does not look like ${icon_name}" >&2
        exit 65
      fi
      ;;
    simple-icons)
      if ! grep -q 'viewBox="0 0 24 24"' "${tmp}"; then
        echo "error: fetched SVG does not look like ${icon_name}" >&2
        exit 65
      fi
      sed 's/viewBox="0 0 24 24"/viewBox="-1 -1 26 26" fill="currentColor"/' "${tmp}" > "${tmp_filtered}"
      ;;
  esac

  mkdir -p "${imageset_dir}"
  mv "${tmp_filtered}" "${svg_path}"
  rm -f "${tmp}"

  cat > "${contents_path}" <<JSON
{
  "images" : [
    {
      "filename" : "${asset_name}.svg",
      "idiom" : "universal"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  },
  "properties" : {
    "preserves-vector-representation" : true,
    "template-rendering-intent" : "template"
  }
}
JSON
done
