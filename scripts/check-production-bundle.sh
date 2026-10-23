#!/usr/bin/env bash
set -euo pipefail

bundle_dir="${1:?usage: scripts/check-production-bundle.sh <wrangler --outdir>}"
testing_api_path="/testing/v1"
dev_home_path="/dev-home"
readonly GREP_FOUND_NO_MATCH=1

[ -s "$bundle_dir/worker.js" ] || { echo "FATAL: $bundle_dir/worker.js is missing or empty; cannot check the production bundle" >&2; exit 1; }

for non_production_path in "$testing_api_path" "$dev_home_path"; do
  grep_status=0
  grep -rlF --exclude='*.map' -- "$non_production_path" "$bundle_dir" || grep_status=$?
  [ "$grep_status" -ne 0 ] || { echo "FATAL: production bundle contains $non_production_path (files listed above)" >&2; exit 1; }
  [ "$grep_status" -eq "$GREP_FOUND_NO_MATCH" ] || { echo "FATAL: grep failed with status $grep_status; cannot check the production bundle" >&2; exit 1; }
done
echo "OK: production bundle has no $testing_api_path or $dev_home_path"
