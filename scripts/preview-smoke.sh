#!/usr/bin/env bash
# Preview URL は DO を持つ Worker では生成されないため、0% で deployment に含めた version を Cloudflare-Workers-Version-Overrides header で指名して本番 URL から呼ぶ
set -u

base="${1:-}"
version="${2:-}"
if [ -z "$base" ] || [ -z "$version" ]; then
  echo "usage: $0 <base-url> <version-id>" >&2
  exit 2
fi
base="${base%/}"
override_header="Cloudflare-Workers-Version-Overrides: taimei-auth=\"$version\""
health_rounds="${PREVIEW_SMOKE_HEALTH_ROUNDS:-20}"
fails=0

fail() {
  echo "FAIL: $1" >&2
  fails=$((fails + 1))
}

probe() {
  local method="$1" path="$2" out status ctype body
  out=$(curl -sS --max-time 30 -X "$method" -H "$override_header" -o /tmp/preview-smoke-body.$$ -w '%{http_code} %{content_type}' "$base$path" 2>&1) || {
    fail "$method $path: curl error: $out"
    echo "000  "
    return
  }
  status="${out%% *}"
  ctype="${out#* }"
  body=$(tr -d '\n' < /tmp/preview-smoke-body.$$ | cut -c1-200)
  rm -f /tmp/preview-smoke-body.$$
  echo "$status|$ctype|$body"
}

echo "preview smoke: $base (version $version)"

# override が効かないと旧 version の 200 で通ってしまうため、先に /health の version を照合する
result=$(probe GET /health)
body="${result##*|}"
case "$body" in
  *"\"version\":\"$version\""*) echo "/health version: $version (override applied)" ;;
  *) fail "/health version mismatch -> $result (expected \"version\":\"$version\"; override header not applied?)" ;;
esac

ok=0
for i in $(seq 1 "$health_rounds"); do
  result=$(probe GET /health)
  status="${result%%|*}"
  if [ "$status" = "200" ]; then
    ok=$((ok + 1))
  else
    fail "/health #$i -> $result"
  fi
done
echo "/health: $ok / $health_rounds returned 200"
[ "$ok" -eq "$health_rounds" ] || fail "/health did not return 200 on every request"

result=$(probe GET /api/account/memberships)
status="${result%%|*}"
body="${result##*|}"
if [ "$status" = "401" ] && [ "$body" = '{"error":"unauthorized"}' ]; then
  echo "/api/account/memberships (no cookie): 401 $body"
else
  fail "/api/account/memberships (no cookie) -> $result (expected 401 {\"error\":\"unauthorized\"})"
fi

result=$(probe GET /auth/)
status="${result%%|*}"
rest="${result#*|}"
ctype="${rest%%|*}"
case "$status:$ctype" in
  200:text/html*) echo "/auth/: 200 $ctype" ;;
  *) fail "/auth/ -> $status $ctype (expected 200 text/html)" ;;
esac

if [ "$fails" -gt 0 ]; then
  echo "preview smoke: $fails failure(s)" >&2
  exit 1
fi
echo "preview smoke: OK"
