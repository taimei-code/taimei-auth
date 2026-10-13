#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# get-exe-path は非対応の TypeScript の版のエラーも stdout に出す
tsc=$(node_modules/.bin/effect-tsgo get-exe-path) || { echo "$tsc" >&2; exit 1; }
"$tsc" --noEmit
"$tsc" --noEmit -p web/tsconfig.json
"$tsc" --noEmit -p packages/auth-client/tsconfig.json
