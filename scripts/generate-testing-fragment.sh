#!/usr/bin/env bash
set -euo pipefail

image="${1:-}"
if [[ ! "$image" =~ ^ghcr\.io/taimei-code/taimei-auth-testing@sha256:[0-9a-f]{64}$ ]]; then
  echo "generate-testing-fragment: expected ghcr.io/taimei-code/taimei-auth-testing@sha256:<digest>, got \"$image\"" >&2
  exit 1
fi

sed "s|__TAIMEI_AUTH_TESTING_IMAGE__|$image|" "$(dirname "$0")/../packages/auth-client/testing/compose.template.yml"
