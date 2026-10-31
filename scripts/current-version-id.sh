#!/usr/bin/env bash
set -euo pipefail

worker="${1:?usage: scripts/current-version-id.sh <worker-name>}"
wrangler="$(cd "$(dirname "$0")/.." && pwd)/node_modules/.bin/wrangler"

cd "$(mktemp -d)"
current=$("$wrangler" deployments status --name "$worker" | sed -n 's/.*(100%) *//p' | tr -d '[:space:]')
[ -n "$current" ] || { echo "current 100% version of $worker not found in deployments status" >&2; exit 1; }
echo "$current"
