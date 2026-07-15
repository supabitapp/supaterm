#!/bin/bash
set -euo pipefail

sha="$1"
repo="${GITHUB_REPOSITORY:-supabitapp/supaterm}"
deadline=$((SECONDS + 3600))

while :; do
  summary=$(gh api "repos/$repo/commits/$sha/check-runs?per_page=100" --paginate --jq '[.check_runs[] | {name, status, conclusion}]' \
    | jq -s '
      add
      | map(select(.name == "mac-test" or .name == "mac-test-e2e" or (.name | startswith("mac-test-ui"))))
      | {
          unit: (map(select(.name == "mac-test")) | length),
          e2e: (map(select(.name == "mac-test-e2e")) | length),
          ui: (map(select(.name | startswith("mac-test-ui"))) | length),
          pending: (map(select(.status != "completed")) | length),
          failed: (map(select(.status == "completed" and (.conclusion | IN("success", "skipped", "neutral") | not)) | .name) | join(", "))
        }')
  unit=$(jq -r '.unit' <<< "$summary")
  e2e=$(jq -r '.e2e' <<< "$summary")
  ui=$(jq -r '.ui' <<< "$summary")
  pending=$(jq -r '.pending' <<< "$summary")
  failed=$(jq -r '.failed' <<< "$summary")

  if [ -n "$failed" ]; then
    echo "::error::Required test check failed on $sha: $failed"
    exit 1
  fi
  if [ "$unit" -gt 0 ] && [ "$e2e" -gt 0 ] && [ "$ui" -gt 0 ] && [ "$pending" -eq 0 ]; then
    echo "All required test checks passed on $sha (unit=$unit e2e=$e2e ui=$ui)"
    exit 0
  fi
  if (( SECONDS >= deadline )); then
    echo "::error::Timed out waiting for test checks on $sha (unit=$unit e2e=$e2e ui=$ui pending=$pending)"
    exit 1
  fi
  echo "Waiting for test checks on $sha (unit=$unit e2e=$e2e ui=$ui pending=$pending)"
  sleep 60
done
