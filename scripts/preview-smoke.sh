#!/usr/bin/env bash
# Preview URL は DO を持つ Worker では生成されないため、0% で deployment に含めた version を Cloudflare-Workers-Version-Overrides header で指名して本番 URL から呼ぶ
set -u

base="${1:-}"
worker="${2:-}"
version="${3:-}"
access="${4:-}"
usage="usage: $0 <base-url> <worker-name> <version-id> <public|access>"
if [ -z "$base" ] || [ -z "$worker" ] || [ -z "$version" ]; then
  echo "$usage" >&2
  exit 2
fi
access_headers=()
case "$access" in
  public) ;;
  access)
    if [ -z "${ACCESS_CLIENT_ID:-}" ] || [ -z "${ACCESS_CLIENT_SECRET:-}" ]; then
      echo "ACCESS_CLIENT_ID and ACCESS_CLIENT_SECRET are required with access" >&2
      exit 2
    fi
    access_headers=(-H "CF-Access-Client-Id: $ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $ACCESS_CLIENT_SECRET")
    ;;
  *)
    echo "$usage" >&2
    exit 2
    ;;
esac
base="${base%/}"
override_header="Cloudflare-Workers-Version-Overrides: $worker=\"$version\""
health_rounds="${PREVIEW_SMOKE_HEALTH_ROUNDS:-20}"
fails=0

fail() {
  echo "FAIL: $1" >&2
  fails=$((fails + 1))
}

probe() {
  local method="$1" path="$2" out status ctype body
  out=$(curl -sS --max-time 30 -X "$method" -H "$override_header" ${access_headers[@]+"${access_headers[@]}"} -o /tmp/preview-smoke-body.$$ -w '%{http_code} %{content_type}' "$base$path" 2>&1) || {
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
# override は deployment 変更後、全世界で有効になるまで数秒かかる (Cloudflare docs "Version overrides")
override_wait="${PREVIEW_SMOKE_OVERRIDE_WAIT:-30}"
override_deadline=$((SECONDS + override_wait))
while :; do
  result=$(probe GET /health)
  body="${result##*|}"
  case "$body" in
    *"\"version\":\"$version\""*)
      echo "/health version: $version (override applied)"
      break
      ;;
  esac
  if [ "$SECONDS" -ge "$override_deadline" ]; then
    fail "/health version mismatch after ${override_wait}s -> $result (expected \"version\":\"$version\"; override header not applied?)"
    break
  fi
  echo "/health version not yet $version: $body"
  sleep 2
done

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
if [ "$status" = "401" ] && [ "$body" = '{"_tag":"Unauthorized"}' ]; then
  echo "/api/account/memberships (no cookie): 401 $body"
else
  fail "/api/account/memberships (no cookie) -> $result (expected 401 {\"_tag\":\"Unauthorized\"})"
fi

result=$(probe GET /auth/)
status="${result%%|*}"
rest="${result#*|}"
ctype="${rest%%|*}"
case "$status:$ctype" in
  200:text/html*) echo "/auth/: 200 $ctype" ;;
  *) fail "/auth/ -> $status $ctype (expected 200 text/html)" ;;
esac

if [ "$access" = "access" ]; then
  out=$(curl -sS --max-time 30 -o /dev/null -w '%{http_code} %{redirect_url}' "$base/health" 2>&1) || out="000 $out"
  status="${out%% *}"
  location="${out#* }"
  case "$status:$location" in
    302:*.cloudflareaccess.com/* | 403:*) echo "/health (no Access token): blocked ($status)" ;;
    *) fail "/health (no Access token) -> $status $location (expected 302 to *.cloudflareaccess.com or 403)" ;;
  esac
fi

if [ "$fails" -gt 0 ]; then
  echo "preview smoke: $fails failure(s)" >&2
  exit 1
fi
echo "preview smoke: OK"
