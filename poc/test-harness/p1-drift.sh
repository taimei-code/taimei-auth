#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT=poc/test-harness/out
mkdir -p "$OUT"
FILES=(packages/auth-client/src/testing.ts src/testing/routes.ts proto/auth/testing/v1/testing.proto)
for f in "${FILES[@]}"; do cp "$f" "$OUT/$(basename "$f").orig"; done
restore() {
  for f in "${FILES[@]}"; do cp "$OUT/$(basename "$f").orig" "$f"; done
  bun run generate >/dev/null 2>&1
  (cd packages/auth-client && bun run build >/dev/null 2>&1)
}
trap restore EXIT

typecheck() {
  local label=$1
  (cd packages/auth-client && bun run build >/dev/null 2>&1)
  bash scripts/typecheck.sh >"$OUT/p1-$label.log" 2>&1
  local errors
  errors=$(grep -c 'error TS' "$OUT/p1-$label.log" || true)
  echo "RESULT $label typecheck-errors=$errors"
  grep 'error TS' "$OUT/p1-$label.log" | head -3
}

restore
perl -pi -e 's/loginUrl: string;/signInUrl: string;/' packages/auth-client/src/testing.ts
typecheck b1-rename-response-field-with-return-annotation

restore
perl -pi -e 's/loginUrl: string;/signInUrl: string;/' packages/auth-client/src/testing.ts
perl -pi -e 's/\): Promise<SignedInUser> => \{/) => {/' src/testing/routes.ts
typecheck b1-rename-response-field-without-return-annotation

restore
perl -pi -e 's/string login_url = 4;/string sign_in_url = 4;/' proto/auth/testing/v1/testing.proto
bun run generate >/dev/null 2>&1
typecheck b2-rename-response-field

restore
perl -pi -e 's/string return_to = 4;/string return_url = 4;/' proto/auth/testing/v1/testing.proto
bun run generate >/dev/null 2>&1
typecheck b2-rename-request-field

restore
perl -pi -e 's/  returnTo: string;/  returnUrl: string;/' packages/auth-client/src/testing.ts
typecheck b1-rename-request-field
