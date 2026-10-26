#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

base_ref="${1:?usage: check-sdk-breaking.sh <base ref, e.g. origin/main>}"
package_json=packages/auth-client/package.json

major_of() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version.split(".")[0]))'
}

BUF_FOUND_BREAKING=100

buf_status=0
bunx @bufbuild/buf breaking --against ".git#ref=$base_ref" || buf_status=$?
if (( buf_status == 0 )); then
  echo "buf breaking: 破壊的変更なし"
  exit 0
fi
if (( buf_status != BUF_FOUND_BREAKING )); then
  echo "::error::buf breaking が判定の前に失敗した (exit $buf_status)。設定か $base_ref を確かめる" >&2
  exit "$buf_status"
fi

base_major=$(git show "$base_ref:$package_json" | major_of)
head_major=$(major_of < "$package_json")

if (( head_major > base_major )); then
  echo "::notice::proto の破壊的変更。SDK の major が $base_major から $head_major に上がっている"
  exit 0
fi

echo "::error::proto の破壊的変更がある。SDK の major を上げる ($package_json の version、$base_ref は major $base_major)" >&2
exit 1
