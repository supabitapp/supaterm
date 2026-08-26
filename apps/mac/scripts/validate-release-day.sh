#!/bin/bash

set -euo pipefail

if [ "${CONFIGURATION:-}" = "Release" ]; then
  if [ -z "${SUPATERM_RELEASE_DATE:-}" ]; then
    echo "error: SUPATERM_RELEASE_DATE is required for Release builds" >&2
    exit 1
  fi
  if ! /usr/bin/python3 -c 'from datetime import date; import os; value = os.environ["SUPATERM_RELEASE_DATE"]; assert date.fromisoformat(value).isoformat() == value' 2>/dev/null; then
    echo "error: SUPATERM_RELEASE_DATE must use YYYY-MM-DD" >&2
    exit 1
  fi
fi
