#!/usr/bin/env bash
set -euo pipefail

posthog_cli_version="0.11.0"
posthog_cli_target="x86_64-unknown-linux-gnu"
posthog_cli_archive="posthog-cli-${posthog_cli_target}.tar.gz"
posthog_cli_checksum="bf3c50cff80ee0d14193860ddb862e41ec4a4bca048d8885d3192eec3730a2fe"
posthog_cli_install_dir="${RUNNER_TEMP:?}/posthog-cli-${posthog_cli_version}"
posthog_cli_url="https://github.com/PostHog/posthog/releases/download/posthog-cli/v${posthog_cli_version}/${posthog_cli_archive}"

mkdir -p "${posthog_cli_install_dir}"
curl \
  --proto '=https' \
  --tlsv1.2 \
  --location \
  --retry 3 \
  --retry-all-errors \
  --silent \
  --show-error \
  --fail \
  --output "${posthog_cli_install_dir}/${posthog_cli_archive}" \
  "${posthog_cli_url}"
printf '%s  %s\n' "${posthog_cli_checksum}" "${posthog_cli_install_dir}/${posthog_cli_archive}" | sha256sum --check
tar -xzf "${posthog_cli_install_dir}/${posthog_cli_archive}" --strip-components 1 -C "${posthog_cli_install_dir}"
printf '%s\n' "${posthog_cli_install_dir}" >> "${GITHUB_PATH:?}"
"${posthog_cli_install_dir}/posthog-cli" --version
