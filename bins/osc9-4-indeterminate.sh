#!/usr/bin/env bash
set -euo pipefail

duration_seconds=${1:-"5"}

printf '\033]9;4;3\a'
sleep "$duration_seconds"
printf '\033]9;4;0\a'
