#!/usr/bin/env bash
set -euo pipefail

window_title=${1:-"Title"}
icon_name=${2:-"$window_title"}

printf '\033]0;%s\a' "$window_title"
printf '\033]1;%s\a' "$icon_name"
printf '\033]2;%s\a' "$window_title"
