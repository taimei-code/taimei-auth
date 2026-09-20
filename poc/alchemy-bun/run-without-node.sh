#!/usr/bin/env bash
# PATH から node を外して Bun だけで実行する。使い方: bash run-without-node.sh <bun の引数...>
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"
echo "node in PATH: $(command -v node || echo none)"
echo "bun: $(command -v bun) $(bun --version)"
exec bun "$@"
