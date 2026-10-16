#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.."
HERE=poc/test-harness
OUT=$HERE/out
mkdir -p "$OUT"
cp src/app.ts "$OUT/app.ts.orig"
trap 'cp "$OUT/app.ts.orig" src/app.ts' EXIT

export DATABASE_URL=${DATABASE_URL:-postgres://postgres:password@127.0.0.1:5435/auth}
export AUTH_SERVICE_URL=http://localhost:3199 AUTH_SECRET=poc-secret-for-testing-harness-32chars
export AUTH_TRUSTED_ORIGINS=http://localhost:3000,http://localhost:3199

apply_variant() {
  {
    printf 'import { testingRoutes } from "./testing/routes";\n'
    printf 'import { TESTING_PATH } from "@taimei-code/auth-client/testing";\n'
    cat "$OUT/app.ts.orig"
  } >src/app.ts
  SNIPPET_FILE=$1 perl -0pi -e 'open my $f, "<", $ENV{SNIPPET_FILE} or die; local $/; my $s = <$f>; s/(  options\.mountStatic\(app\);)/$s$1/' src/app.ts
}

probe() {
  env "$@" bun test "$HERE/gate-probe.test.ts" 2>&1 | grep '^RESULT' || echo "RESULT $* => probe failed"
}

echo "== D1 (common app = src/index.ts と src/worker.ts が使う buildApp)"
cp "$OUT/app.ts.orig" src/app.ts
probe -u APP_ENV POC_VARIANT=d1
probe POC_VARIANT=d1 APP_ENV=production
probe POC_VARIANT=d1 APP_ENV=prodution
probe POC_VARIANT=d1 APP_ENV=test

echo "== D1 (src/testing-server.ts)"
APP_ENV=production PORT=3199 bun run src/testing-server.ts >"$OUT/d1-prod.log" 2>&1 &
pid=$!; sleep 5; kill -0 $pid 2>/dev/null && { kill $pid; echo still-running >>"$OUT/d1-prod.log"; }; wait $pid
echo "RESULT variant=d1 entry=testing-server APP_ENV=production => exit=$? $(grep -o 'FATAL.*' "$OUT/d1-prod.log" | head -1)"
APP_ENV=test PORT=3199 AUTH_TRUSTED_PROXY_HOPS=0 bun run src/testing-server.ts >"$OUT/d1-test.log" 2>&1 &
pid=$!
for _ in $(seq 1 40); do curl -s -o /dev/null http://localhost:3199/health && break; sleep 0.5; done
status=$(curl -s -o "$OUT/d1-test.json" -w '%{http_code}' -X POST http://localhost:3199/testing/v1/signed-in-users \
  -H 'Content-Type: application/json' -d '{"companies":[{"role":"OWNER"}],"returnTo":"http://localhost:3000/after"}')
echo "RESULT variant=d1 entry=testing-server APP_ENV=test => status=$status"
plain=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3199/testing/v1/signed-in-users -H 'Content-Type: application/json' -d '{}')
kill $pid; wait $pid 2>/dev/null
APP_ENV=test PORT=3199 AUTH_TRUSTED_PROXY_HOPS=0 bun run src/index.ts >"$OUT/d1-index.log" 2>&1 &
pid=$!
for _ in $(seq 1 40); do curl -s -o /dev/null http://localhost:3199/health && break; sleep 0.5; done
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3199/testing/v1/signed-in-users \
  -H 'Content-Type: application/json' -d '{"companies":[{"role":"OWNER"}],"returnTo":"http://localhost:3000/after"}')
echo "RESULT variant=d1 entry=index APP_ENV=test => status=$status"
kill $pid; wait $pid 2>/dev/null

echo "== D2"
apply_variant "$HERE/app-d2.ts.snippet"
probe -u APP_ENV -u AUTH_TESTING_API POC_VARIANT=d2
probe -u AUTH_TESTING_API POC_VARIANT=d2 APP_ENV=production
probe -u APP_ENV POC_VARIANT=d2 AUTH_TESTING_API=enable
probe POC_VARIANT=d2 APP_ENV=production AUTH_TESTING_API=enabled
probe POC_VARIANT=d2 APP_ENV=test AUTH_TESTING_API=enabled

echo "== D3"
apply_variant "$HERE/app-d3.ts.snippet"
probe -u APP_ENV -u AUTH_TESTING_KEY POC_VARIANT=d3 POC_SEND_KEY=guess
probe POC_VARIANT=d3 APP_ENV=test AUTH_TESTING_KEY=k1 POC_SEND_KEY=wrong
probe POC_VARIANT=d3 APP_ENV=test AUTH_TESTING_KEY=k1 POC_SEND_KEY=k1
probe POC_VARIANT=d3 APP_ENV=production AUTH_TESTING_KEY=k1 POC_SEND_KEY=k1
