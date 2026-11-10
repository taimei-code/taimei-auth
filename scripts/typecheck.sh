#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

bun run --cwd packages/auth-client build

# get-exe-path は非対応の TypeScript の版のエラーも stdout に出す
tsc=$(node_modules/.bin/effect-tsgo get-exe-path) || { echo "$tsc" >&2; exit 1; }
"$tsc" --noEmit
"$tsc" --noEmit -p testing/tsconfig.json
"$tsc" --noEmit -p web/tsconfig.json
"$tsc" -b web/domain-projects/index.json
"$tsc" --noEmit -p packages/auth-client/tsconfig.json
"$tsc" --noEmit -p packages/auth-client/tsconfig.testing-node.json
