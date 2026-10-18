#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:?usage: scripts/check-production-bundle.sh <wrangler --outdir>}"
testing_api_path="/testing/v1"
readonly GREP_FOUND_NO_MATCH=1

[ -s "$bundle_dir/worker.js" ] || { echo "FATAL: $bundle_dir/worker.js is missing or empty; cannot check the production bundle" >&2; exit 1; }

grep_status=0
grep -rlF --exclude='*.map' -- "$testing_api_path" "$bundle_dir" || grep_status=$?
[ "$grep_status" -ne 0 ] || { echo "FATAL: production bundle contains $testing_api_path (files listed above)" >&2; exit 1; }
[ "$grep_status" -eq "$GREP_FOUND_NO_MATCH" ] || { echo "FATAL: grep failed with status $grep_status; cannot check the production bundle" >&2; exit 1; }
echo "OK: production bundle has no $testing_api_path"
