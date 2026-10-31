#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
out_dir="$PWD/staging-bundle"

bun run --cwd packages/auth-client build
bun run build:web:non-production
cd testing
bunx wrangler versions upload staging-worker.ts --config wrangler.jsonc --dry-run --outdir "$out_dir"
