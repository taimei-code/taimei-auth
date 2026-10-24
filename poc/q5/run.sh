#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"
wrangler_bin="$(git rev-parse --show-toplevel)/node_modules/.bin/wrangler"
w() { "$wrangler_bin" "$@"; }
step() { echo; echo "::group::$1"; }
end() { echo "exit=$1"; echo "::endgroup::"; }

step "1 wrangler deploy v1 (worker を作る)"
w deploy -c wrangler-v1.jsonc; end $?

step "2 versions upload v1 (migration なし)"
w versions upload -c wrangler-v1.jsonc --tag poc-a | tee upload-a.log; end "${PIPESTATUS[0]}"
version_a=$(sed -n 's/^Worker Version ID: *//p' upload-a.log | tr -d '[:space:]')
[ -n "$version_a" ] || { echo "version_a empty"; exit 1; }
current=$(w deployments status -c wrangler-v1.jsonc | sed -n 's/.*(100%) *//p' | tr -d '[:space:]')
echo "version_a=$version_a current=$current"

step "3 versions deploy a@0% current@100% (段階的な反映)"
w versions deploy "${version_a}@0%" "${current}@100%" --yes -c wrangler-v1.jsonc; end $?

step "4 versions upload v2 (migration v2 を足す)"
w versions upload -c wrangler-v2.jsonc --tag poc-b; end $?

step "5 wrangler deploy v2 (migration を適用)"
w deploy -c wrangler-v2.jsonc; end $?
w deployments status -c wrangler-v2.jsonc

step "6 versions upload v2 (適用後)"
w versions upload -c wrangler-v2.jsonc --tag poc-c | tee upload-c.log; end "${PIPESTATUS[0]}"
version_c=$(sed -n 's/^Worker Version ID: *//p' upload-c.log | tr -d '[:space:]')
[ -n "$version_c" ] || { echo "version_c empty"; exit 1; }
current=$(w deployments status -c wrangler-v2.jsonc | sed -n 's/.*(100%) *//p' | tr -d '[:space:]')
echo "version_c=$version_c current=$current"

step "7 versions deploy c@0% current@100% (適用後の段階的な反映)"
w versions deploy "${version_c}@0%" "${current}@100%" --yes -c wrangler-v2.jsonc; end $?

step "8 versions deploy a@100% (migration 前の version へ戻す)"
w versions deploy "${version_a}@100%" --yes -c wrangler-v2.jsonc; end $?
w deployments status -c wrangler-v2.jsonc
