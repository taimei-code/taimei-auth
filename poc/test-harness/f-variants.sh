#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.."
SDK=packages/auth-client
OUT=poc/test-harness/out
CONSUMER=${CONSUMER:-../taimei-poc-test-harness}
mkdir -p "$OUT"
export DATABASE_URL=${DATABASE_URL:-postgres://postgres:password@127.0.0.1:5435/auth}
for f in types.ts guard.ts index.ts; do cp "$SDK/src/$f" "$OUT/$f.orig"; done
restore() { for f in types.ts guard.ts index.ts; do cp "$OUT/$f.orig" "$SDK/src/$f"; done; }
trap 'restore; (cd "$SDK" && bun run build >/dev/null)' EXIT

field_variant() {
  local marker=$1
  perl -0pi -e "s|(  role\\?: Role;\\n)|\$1  justSignedUp${marker}: boolean;\\n|" "$SDK/src/types.ts"
  perl -0pi -e 's|(import \{\n  type CompanyMember,)|import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "./auth-host";\n$1|; s|(    role: currentRole === undefined \? undefined : ROLE_BY_PROTO\[currentRole\],\n)|$1    justSignedUp: Date.now() - Date.parse(user.createdAt) < MAGIC_LINK_EXPIRES_IN_SECONDS * 1000,\n|' "$SDK/src/guard.ts"
}

function_variant() {
  cat >>"$SDK/src/index.ts" <<'TS'
import { MAGIC_LINK_EXPIRES_IN_SECONDS as SIGN_UP_WINDOW_SECONDS } from "./auth-host";
import type { SessionData as SignUpSessionData } from "./types";
export const isJustSignedUp = (data: SignUpSessionData, now: number = Date.now()): boolean =>
  now - Date.parse(data.user.createdAt) < SIGN_UP_WINDOW_SECONDS * 1000;
TS
}

for variant in f2-required f2-optional f3-function; do
  restore
  case $variant in
    f2-required) field_variant "" ;;
    f2-optional) field_variant "?" ;;
    f3-function) function_variant ;;
  esac
  (cd "$SDK" && bun run build >"../../$OUT/$variant-build.log" 2>&1) || { echo "RESULT $variant sdk-build=fail"; continue; }
  sdk_test=$(bun test "$SDK/src/__tests__" 2>&1 | grep -E '^ *[0-9]+ (pass|fail)' | tr '\n' ' ')
  rm -rf "$CONSUMER/node_modules/@taimei-code/auth-client/dist"
  cp -R "$SDK/dist" "$CONSUMER/node_modules/@taimei-code/auth-client/dist"
  (cd "$CONSUMER" && bash scripts/typecheck.sh >"$(pwd -P)/../taimei-auth-poc-test-harness/$OUT/$variant-consumer-tc.log" 2>&1)
  tc=$?
  errors=$(grep -c 'error TS' "$OUT/$variant-consumer-tc.log" || true)
  echo "RESULT $variant sdk-tests=[$sdk_test] consumer-typecheck-exit=$tc consumer-ts-errors=$errors"
  grep 'error TS' "$OUT/$variant-consumer-tc.log" | head -3
done
restore
(cd "$SDK" && bun run build >/dev/null)
rm -rf "$CONSUMER/node_modules/@taimei-code/auth-client/dist"
cp -R ../taimei/node_modules/@taimei-code/auth-client/dist "$CONSUMER/node_modules/@taimei-code/auth-client/dist"
