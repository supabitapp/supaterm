#!/usr/bin/env bash
set -euo pipefail

xcframework_path="${1:?missing xcframework path}"

find "$xcframework_path" -path '*/Headers/module.modulemap' -print0 | while IFS= read -r -d '' modulemap; do
  cat > "$modulemap" <<'EOF'
module GhosttyKit {
    header "ghostty.h"
    export *
}
EOF
done
