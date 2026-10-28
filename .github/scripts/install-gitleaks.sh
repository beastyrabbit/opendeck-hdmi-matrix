#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"

gitleaks_version="8.30.1"
gitleaks_archive="gitleaks_${gitleaks_version}_linux_x64.tar.gz"
gitleaks_sha256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
gitleaks_tmp="$(mktemp -d "${RUNNER_TEMP}/gitleaks.XXXXXX")"

curl --proto '=https' --tlsv1.2 --fail --location --show-error \
  --output "${gitleaks_tmp}/${gitleaks_archive}" \
  "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/${gitleaks_archive}"

printf '%s  %s\n' "$gitleaks_sha256" "${gitleaks_tmp}/${gitleaks_archive}" | sha256sum --check --status
tar --extract --gzip --file "${gitleaks_tmp}/${gitleaks_archive}" --directory "$gitleaks_tmp" gitleaks
"${gitleaks_tmp}/gitleaks" version
printf '%s\n' "$gitleaks_tmp" >> "$GITHUB_PATH"
