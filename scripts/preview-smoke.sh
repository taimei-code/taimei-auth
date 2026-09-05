#!/usr/bin/env bash
# デプロイ前の preview smoke。`wrangler versions upload` で上げた (まだ本番 traffic に乗っていない) version の
# preview URL に対し、実 workerd + 実 binding (Hyperdrive / Upstash) で runtime が動くことを確認する。
# deploy.yml がこの script の exit code を gate にし、落ちたら `wrangler versions deploy` を実行しない。
# 見ているもの (旧 QA-MR-03 / QA-MR-11 の手動手順を置き換える):
#   - /health x20 が全部 200: request ごとの ALS pool と Effect runtime の上で DB ping + Redis ping が通る
#     (warm isolate が前 request の接続を掴む "Worker hung" (#91) の非再発)
#   - 未認証 GET /api/account/memberships が 401 {"error":"unauthorized"}: adapter と guard の failure が
#     workerd 上で wire に写像される
#   - GET /auth/ が 200 text/html: ASSETS binding の SPA 配信
# 認証付き経路は session cookie が要るため対象外 (runtime 機構は /health と同じ。残るリスクは Sentry と rollback で受ける)。
# usage: scripts/preview-smoke.sh <preview-base-url>   例: https://711abba4-taimei-auth.<subdomain>.workers.dev
set -u

base="${1:-}"
if [ -z "$base" ]; then
  echo "usage: $0 <preview-base-url>" >&2
  exit 2
fi
base="${base%/}"
health_rounds="${PREVIEW_SMOKE_HEALTH_ROUNDS:-20}"
fails=0

fail() {
  echo "FAIL: $1" >&2
  fails=$((fails + 1))
}

# 1 request 分の status / content-type / body を取る (body は 1 行に潰して先頭だけ残す)。
probe() {
  local method="$1" path="$2" out status ctype body
  out=$(curl -sS --max-time 30 -X "$method" -o /tmp/preview-smoke-body.$$ -w '%{http_code} %{content_type}' "$base$path" 2>&1) || {
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

echo "preview smoke: $base"

# --- /health x N -------------------------------------------------------------------------------
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

# --- unauthenticated guard path ----------------------------------------------------------------
result=$(probe GET /api/account/memberships)
status="${result%%|*}"
body="${result##*|}"
if [ "$status" = "401" ] && [ "$body" = '{"error":"unauthorized"}' ]; then
  echo "/api/account/memberships (no cookie): 401 $body"
else
  fail "/api/account/memberships (no cookie) -> $result (expected 401 {\"error\":\"unauthorized\"})"
fi

# --- SPA shell via ASSETS ----------------------------------------------------------------------
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
