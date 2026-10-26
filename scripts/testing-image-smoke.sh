#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

image="${1:?usage: testing-image-smoke.sh <image> [compose template]}"
template="${2:-packages/auth-client/testing/compose.template.yml}"
port="${TESTING_IMAGE_SMOKE_PORT:-3199}"
project=testing-image-smoke
work=$(mktemp -d)
fragment="$work/compose.yml"
override="$work/override.yml"

sed "s|__TAIMEI_AUTH_TESTING_IMAGE__|$image|" "$template" > "$fragment"
printf 'services:\n  taimei-auth:\n    ports: ["127.0.0.1:%s:%s"]\n' "$port" "$port" > "$override"

export TAIMEI_AUTH_URL="http://localhost:$port"
export TAIMEI_AUTH_HOSTNAME=localhost
export TAIMEI_AUTH_COOKIE_DOMAIN=
export TAIMEI_AUTH_CONSUMER_ORIGINS=http://localhost:3000
TAIMEI_AUTH_SECRET="$(openssl rand -hex 32)"
export TAIMEI_AUTH_SECRET
export TAIMEI_AUTH_SERVICE_KEY=testing-image-smoke-service-key
export TAIMEI_AUTH_APP_NAME=testing-image-smoke
export TAIMEI_AUTH_PORT="$port"

compose() { docker compose -p "$project" -f "$fragment" -f "$override" "$@"; }
cleanup() {
  compose down -v >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

compose up --wait --quiet-pull

curl -fsS -o /dev/null "$TAIMEI_AUTH_URL/health"
echo "ok: /health は 200"

# shellcheck disable=SC2016
compose exec -T -e TAIMEI_AUTH_URL="http://localhost:$port" taimei-auth bun -e '
import { buildSessionCookieHeader, extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client/cookie";
import { createTestingClient, DEV_HOME_PATH } from "@taimei-code/auth-client/testing";
const authUrl = process.env.TAIMEI_AUTH_URL;
const user = await createTestingClient(authUrl).createSignedInUser({
  companies: [{ role: "OWNER" }],
  returnTo: `${authUrl}/account`,
});
const login = await fetch(user.loginUrl, { redirect: "manual" });
const token = extractSessionTokenFromCookieHeader(
  login.headers.getSetCookie().map((setCookie) => setCookie.split(";")[0]).join("; "),
);
if (!token) throw new Error("loginUrl を開いても session cookie が付かない");
const session = await (
  await fetch(`${authUrl}/api/auth/get-session`, { headers: { cookie: buildSessionCookieHeader(token) } })
).json();
if (session?.user?.id !== user.userId) throw new Error(`試験の利用者でログインできない: ${JSON.stringify(session)}`);
console.log("ok: 試験の利用者の loginUrl でログインできる");
const devHome = await fetch(`${authUrl}${DEV_HOME_PATH}`);
if (devHome.status !== 200) throw new Error(`開発者ホームが ${devHome.status} を返す`);
console.log("ok: 開発者ホームは 200");
'

if output=$(compose run --rm --no-deps -e APP_ENV=production taimei-auth bun --preload=./testing/redirect-hosts-plugin.ts testing/server.ts 2>&1); then
  echo "APP_ENV=production で試験用の entry が起動した" >&2
  exit 1
fi
grep -q "FATAL" <<<"$output"
echo "ok: APP_ENV=production の試験用の entry は FATAL で止まる"
