#!/usr/bin/env bash
# デプロイ前の smoke。`wrangler versions upload` で上げて 0% で deployment に含めた version を、
# Cloudflare-Workers-Version-Overrides header で指名して本番 URL から呼び、実際の workerd と実際の binding
# (Hyperdrive と DO) で runtime が動くことを確認する。Preview URL は DO を持つ Worker では
# 生成されない (Cloudflare の制約) ため header 方式にしている。override が適用されないと旧 version の 200 で
# 中身の無いまま通ってしまうので、/health の version が指名した id と一致することを最初に確かめる。
# deploy.yml がこの script の exit code を gate にし、落ちたら新 version を 100% にしない。
# 見ているもの (以前の QA-MR-03 と QA-MR-11 の手動手順を置き換える):
#   - /health を 20 回呼んで全部 200 になること。request ごとの ALS pool と Effect runtime の上で DB の ping と TTL store の ping が通る
#     (warm な isolate が前の request の接続を使い回す "Worker hung" (#91) が再発していないこと)
#   - 未認証の GET /api/account/memberships が 401 {"error":"unauthorized"} になること。adapter と guard の failure が
#     workerd 上で応答に変換される
#   - GET /auth/ が 200 text/html になること。ASSETS binding が SPA を配信する
# 認証付きの経路は session cookie が要るため対象外にする (runtime の仕組みは /health と同じ。残るリスクは Sentry と rollback で受ける)。
# usage: scripts/preview-smoke.sh <base-url> <version-id>   例: https://auth.taimei-code.com 711abba4-…
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

# 1 request 分の status、content-type、body を取る (body は 1 行にまとめて先頭だけ残す)。
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

# --- override が適用されていること (/health の version が指名した id と一致する) ------------------------------
result=$(probe GET /health)
body="${result##*|}"
case "$body" in
  *"\"version\":\"$version\""*) echo "/health version: $version (override applied)" ;;
  *) fail "/health version mismatch -> $result (expected \"version\":\"$version\"; override header not applied?)" ;;
esac

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
