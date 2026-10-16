#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
HERE=poc/test-harness
OUT=$HERE/out
mkdir -p "$OUT"
cp src/app.ts "$OUT/app.ts.orig"
trap 'cp "$OUT/app.ts.orig" src/app.ts' EXIT

apply_variant() {
  local snippet=$1
  {
    printf 'import { testingRoutes } from "./testing/routes";\n'
    printf 'import { TESTING_PATH } from "@taimei-code/auth-client/testing";\n'
    cat "$OUT/app.ts.orig"
  } >src/app.ts
  SNIPPET_FILE=$snippet perl -0pi -e 'open my $f, "<", $ENV{SNIPPET_FILE} or die; local $/; my $s = <$f>; s/(  options\.mountStatic\(app\);)/$s$1/' src/app.ts
}

for variant in d1 d2 d3; do
  cp "$OUT/app.ts.orig" src/app.ts
  case $variant in
    d2) apply_variant "$HERE/app-d2.ts.snippet" ;;
    d3) apply_variant "$HERE/app-d3.ts.snippet" ;;
  esac
  rm -rf "${OUT:?}/$variant"
  bunx wrangler deploy --dry-run --outdir "$OUT/$variant" >"$OUT/$variant.log" 2>&1
  js=$(find "$OUT/$variant" -maxdepth 1 -name '*.js' | head -1)
  printf '%s bytes=%s gzip=%s testing_path=%s signed_in_users=%s\n' "$variant" \
    "$(wc -c <"$js" | tr -d ' ')" "$(gzip -9c "$js" | wc -c | tr -d ' ')" \
    "$(grep -c '/testing/v1' "$js" || true)" "$(grep -c 'signed-in-users' "$js" || true)"
done
