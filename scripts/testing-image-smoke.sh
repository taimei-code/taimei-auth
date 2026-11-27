#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

image="${1:?usage: testing-image-smoke.sh <image> [compose template]}"
template=$(realpath "${2:-packages/auth-client/testing/compose.template.yml}")
port="${TESTING_IMAGE_SMOKE_PORT:-3199}"
relay_port="${TESTING_IMAGE_SMOKE_RELAY_PORT:-3198}"
project=testing-image-smoke
relay_project=testing-image-smoke-relay
dev_environment_network=testing-image-smoke-dev-environment
dev_environment_auth=dev-environment-auth
work=$(mktemp -d)
consumer="$work/compose.yml"
override="$work/override.yml"
relay_consumer="$work/relay-compose.yml"
relay_override="$work/relay-override.yml"
service_key=$(sed -n 's/^AUTH_SERVICE_KEY=//p' "$(dirname "$template")/service-key.env")

printf 'include:\n  - path:\n      - "%s"\n      - "%s"\n' "$template" "$override" > "$consumer"
printf 'include:\n  - path:\n      - "%s"\n      - "%s"\n' "$template" "$relay_override" > "$relay_consumer"
cat > "$override" <<YAML
services:
  taimei-auth:
    image: "$image"
    ports: ["127.0.0.1:$port:$port"]
    networks:
      dev-environment:
        aliases: [$dev_environment_auth]
networks:
  dev-environment:
    name: $dev_environment_network
    external: true
YAML
cat > "$relay_override" <<YAML
services:
  taimei-auth-postgres:
    profiles: [relay-has-no-database]
  taimei-auth:
    image: "$image"
    command: !override ["bun", "testing/dev-environment-relay.ts", "$dev_environment_auth:$port"]
    ports: ["127.0.0.1:$relay_port:$relay_port"]
    depends_on: !reset {}
    networks:
      dev-environment: {}
networks:
  dev-environment:
    name: $dev_environment_network
    external: true
YAML

export TAIMEI_AUTH_URL="http://localhost:$port"
export TAIMEI_AUTH_HOSTNAME=localhost
export TAIMEI_AUTH_COOKIE_DOMAIN=
export TAIMEI_AUTH_CONSUMER_ORIGINS=http://localhost:3000
TAIMEI_AUTH_SECRET="$(openssl rand -hex 32)"
export TAIMEI_AUTH_SECRET
export TAIMEI_AUTH_SERVICE_KEY=testing-image-smoke-ignored-service-key
export TAIMEI_AUTH_APP_NAME=testing-image-smoke
export TAIMEI_AUTH_PORT="$port"

compose() { docker compose -p "$project" -f "$consumer" "$@"; }
relay() {
  TAIMEI_AUTH_PORT="$relay_port" TAIMEI_AUTH_URL="http://localhost:$relay_port" \
    docker compose -p "$relay_project" -f "$relay_consumer" "$@"
}
cleanup() {
  relay down -v >/dev/null 2>&1 || true
  compose down -v >/dev/null 2>&1 || true
  docker network rm "$dev_environment_network" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

wait_until() {
  local seconds=$1
  shift
  for _ in $(seq "$seconds"); do
    "$@" && return 0
    sleep 1
  done
  return 1
}
relay_state() { docker inspect -f "{{.State.$1}}" "$relay_container"; }
relay_is_healthy() { [ "$(relay_state Health.Status)" = healthy ]; }
fail_relay() {
  docker logs "$relay_container" >&2 || true
  docker inspect -f '{{json .State.Health}}' "$relay_container" >&2 || true
  echo "$1" >&2
  exit 1
}
relay_reports_unreachable() {
  docker logs "$relay_container" 2>&1 | grep -F "開発環境 ($dev_environment_auth:$port) に届かない" >/dev/null
}

docker network inspect "$dev_environment_network" >/dev/null 2>&1 || docker network create "$dev_environment_network" >/dev/null
relay up -d --quiet-pull
relay_container=$(relay ps -aq taimei-auth)
relay_started_at=$(relay_state StartedAt)
wait_until 30 relay_reports_unreachable || fail_relay "宛先が居ない中継が、開発環境に届かないことを log に出さない"
! relay_is_healthy || fail_relay "宛先が居ない中継が healthy になった"
echo "ok: 宛先が居ない中継は healthy にならず、開発環境に届かないことを log に出す"

compose up --wait --quiet-pull

curl -fsS -o /dev/null "$TAIMEI_AUTH_URL/health"
echo "ok: /health は 200"

expect_rpc_status() {
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$1/rpc/auth.v1.UserService/FindUserByEmail" \
    -H 'Content-Type: application/json' -H "X-Service-Key: $2" -d '{"email":"nobody@example.com"}')
  [ "$status" = "$3" ] || { echo "$4 の service key を送った RPC が $3 でなく $status を返す" >&2; exit 1; }
}
expect_rpc_status "$TAIMEI_AUTH_URL" "$service_key" 200 "SDK の file"
expect_rpc_status "$TAIMEI_AUTH_URL" "$TAIMEI_AUTH_SERVICE_KEY" 401 TAIMEI_AUTH_SERVICE_KEY
echo "ok: SDK の file の service key の RPC は 200、TAIMEI_AUTH_SERVICE_KEY の値の RPC は 401"

relay_url="http://localhost:$relay_port"
wait_until 60 relay_is_healthy || fail_relay "宛先が起動しても、中継が healthy にならない"
[ "$(relay_state StartedAt)" = "$relay_started_at" ] || fail_relay "中継の container が起動し直された"
curl -fsS -o /dev/null "$relay_url/health"
expect_rpc_status "$relay_url" "$service_key" 200 "中継へ SDK の file"
echo "ok: 宛先が後から起動すると、中継は起動し直さずに healthy になり、/health と RPC を宛先へ渡す"

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
