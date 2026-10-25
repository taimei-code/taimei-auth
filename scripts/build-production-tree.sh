#!/usr/bin/env bash
set -euo pipefail

tree_dir="${1:?usage: scripts/build-production-tree.sh <empty dir to create the production tree in>}"
mkdir -p "$tree_dir"
tree_dir="$(cd "$tree_dir" && pwd)"
[[ -z "$(ls -A "$tree_dir")" ]] || { echo "error: $tree_dir is not empty. Pass a new or empty dir so that files from an earlier tree are not reused." >&2; exit 2; }

cd "$(dirname "$0")/.."

EXCLUDED_FROM_PRODUCTION=(testing web/non-production db/testing)

commit="$(git rev-parse HEAD)"
echo "Building production from HEAD ($commit) without ${EXCLUDED_FROM_PRODUCTION[*]}. Uncommitted changes are not included."

pathspecs=()
for dir in "${EXCLUDED_FROM_PRODUCTION[@]}"; do pathspecs+=(":(exclude)$dir"); done
git archive "$commit" -- . "${pathspecs[@]}" | tar -x -C "$tree_dir"

cd "$tree_dir"
if ! {
  bun install --frozen-lockfile --ignore-scripts &&
    (cd packages/auth-client && bun run build) &&
    bun run build:web &&
    bunx wrangler versions upload --dry-run --outdir production-bundle
}; then
  echo "FATAL: the production build failed in a tree without ${EXCLUDED_FROM_PRODUCTION[*]}. Production code must not import them. Do not move the code into src/ or shorten the exclusion list to make this pass (docs/adr/0021-production-code-knows-no-environment.md)." >&2
  exit 1
fi

bash scripts/check-production-bundle.sh production-bundle web/dist
