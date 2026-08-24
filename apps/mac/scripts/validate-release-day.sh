#!/bin/bash

set -euo pipefail

if [ "${CONFIGURATION:-}" = "Release" ] && [ -z "${SUPATERM_RELEASE_DATE:-}" ]; then
  echo "error: SUPATERM_RELEASE_DATE is required for Release builds" >&2
  exit 1
fi
