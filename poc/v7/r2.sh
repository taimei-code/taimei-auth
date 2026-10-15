#!/usr/bin/env bash
set -euo pipefail
auth=http://localhost:3201
consumer=http://localhost:3202
log=/tmp/poc-v7-auth.log
suffix="${1:-$(date +%s)}"
owner_email="poc-v7-owner-$suffix@example.com"
member_email="poc-v7-member-$suffix@example.com"
psql_exec() { docker exec taimei-auth-auth-postgres-1 psql -U postgres -d auth -At -c "$1"; }

login() {
  local email="$1" link
  curl -s -X POST "$auth/api/auth/sign-in/magic-link" -H 'content-type: application/json' -H "Origin: $auth" \
    -d "{\"email\":\"$email\",\"callbackURL\":\"$auth/account\"}" > /dev/null
  sleep 1.5
  link=$(grep -o "Magic Link for $email: [^ ]*" "$log" | tail -1 | sed 's/.*: //')
  curl -s -i "$link" | grep -i 'set-cookie: better-auth.session_token' | sed 's/.*session_token=//; s/;.*//' | tr -d '\r'
}
header_of() { printf 'better-auth.session_token=%s' "$1"; }
q() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"; }
api() {
  local method="$1" path="$2" token="$3" body="${4:-}"
  curl -s -o /dev/null -w '%{http_code}' -X "$method" "$auth$path" -H 'content-type: application/json' -H "Origin: $auth" \
    -H "Cookie: $(header_of "$token")" ${body:+-d "$body"}
}
summary='import json,sys
d=json.load(sys.stdin)
n=d.get("normalized",d)
src=d.get("source")
if not n.get("ok"):
    print(("[%s] " % src if src else "") + "rejected:" + str(n.get("reason")))
else:
    ms=",".join("%s:%s%s" % (m["email"].split("-")[2] if "-" in m["email"] else m["email"], m["role"], ("(" + m["name"] + ")") if m.get("name") else "") for m in n["members"])
    print(("[%s] " % src if src else "") + "company=%s role=%s members=%s" % ((n["companyId"] or "-")[-6:], n["role"], ms))'
compare() {
  local label="$1" token="$2" offset="${3:-0}" order="${4:-v3-first}" c v3 v7
  c=$(q "$(header_of "$token")")
  if [ "$order" = v7-first ]; then
    v7=$(curl -s "$consumer/v7?cookie=$c&offset=$offset" | python3 -c "$summary")
    v3=$(curl -s "$consumer/result?mode=v3&cookie=$c" | python3 -c "$summary")
  else
    v3=$(curl -s "$consumer/result?mode=v3&cookie=$c" | python3 -c "$summary")
    v7=$(curl -s "$consumer/v7?cookie=$c&offset=$offset" | python3 -c "$summary")
  fi
  printf '%-34s V3: %-60s V7: %s\n' "$label" "$v3" "$v7"
}
warm() { curl -s "$consumer/v7?cookie=$(q "$(header_of "$1")")" > /dev/null; curl -s "$consumer/v7?cookie=$(q "$(header_of "$1")")" > /dev/null; }

owner=$(login "$owner_email")
member=$(login "$member_email")
company1=$(curl -s -X POST "$auth/api/account/companies" -H 'content-type: application/json' -H "Origin: $auth" -H "Cookie: $(header_of "$owner")" -d '{"name":"V7 一社","org_code":"CORPORATE"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["company"]["id"])')
company2=$(curl -s -X POST "$auth/api/account/companies/add" -H 'content-type: application/json' -H "Origin: $auth" -H "Cookie: $(header_of "$owner")" -d '{"name":"V7 二社","org_code":"CORPORATE"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["company"]["id"])')
api POST /api/account/current-company "$owner" "{\"company_id\":\"$company1\"}" > /dev/null
member_id=$(psql_exec "select id from \"user\" where email='$member_email'")
owner_id=$(psql_exec "select id from \"user\" where email='$owner_email'")
psql_exec "insert into membership (id,user_id,company_id,role) values ('mbr_v7_$suffix','$member_id','$company1','MEMBER')" > /dev/null
curl -s "$consumer/v7-invalidate" > /dev/null
echo "fixture: owner + member in company1 (…${company1: -6}), owner also in company2 (…${company2: -6})"

warm "$owner"
compare "T0 warm (2 回目)" "$owner"

echo "status $(api POST "/api/account/companies/$company1/members/$member_id/role" "$owner" '{"role":"ADMIN"}') role change"
compare "T1 メンバーの role の変更" "$owner"

echo "status $(api POST /api/auth/update-user "$member" '{"name":"renamed"}') member renames (better-auth)"
compare "T2 メンバーの名前の変更" "$owner"

echo "status $(api POST "/api/account/companies/$company1/members/$member_id/remove" "$owner") member removal"
compare "T3 メンバーの削除" "$owner"

echo "status $(api POST /api/account/current-company "$owner" "{\"company_id\":\"$company2\"}") company switch"
compare "T4 事業所の切り替え" "$owner"

echo "--- T5 発生源の外の書き込み (SQL で revision を更新)"
warm "$owner"
psql_exec "update \"user\" set revision = revision + 1 where id='$owner_id'" > /dev/null
compare "T5 revision の更新 (V7 を先に読む)" "$owner" 0 v7-first
compare "T5' 続けてもう一度" "$owner" 0 v7-first

owner=$(login "$owner_email")
warm "$owner"
echo "status $(api POST /api/auth/sign-out "$owner" '{}') sign out"
compare "T6 sign out" "$owner"

owner=$(login "$owner_email")
warm "$owner"
compare "T8a 5 分後 (snapshot の寿命)" "$owner" $((6 * 60 * 1000))
curl -s "$consumer/v7?cookie=$(q "$(header_of "$owner")")&offset=$((8 * 24 * 3600 * 1000))" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("T8b 8 日後 (session の期限の後) の V7 の source:", d["source"])'

echo "--- T9 消す処理の失敗"
warm "$owner"
curl -s "$consumer/v7-fail?on=1" > /dev/null
echo "status $(api POST /api/account/current-company "$owner" "{\"company_id\":\"$company1\"}") company switch while invalidation fails"
curl -s "$consumer/v7-fail?on=0" > /dev/null
compare "T9 失敗の直後" "$owner" 0 v7-first
compare "T9' 5 分後" "$owner" $((6 * 60 * 1000)) v7-first

echo "--- T10 読み取りと書き込みの競合"
c=$(q "$(header_of "$owner")")
curl -s "$consumer/v7-invalidate" > /dev/null
begin=$(curl -s "$consumer/v7-begin?cookie=$c")
echo "status $(api POST /api/account/current-company "$owner" "{\"company_id\":\"$company2\"}") company switch between read and fill"
fill=$(curl -s -X POST "$consumer/v7-fill?cookie=$c" -H 'content-type: application/json' -d "$begin")
echo "T10 古い値の書き戻し: $fill"
compare "T10 その後の読み取り" "$owner"

member=$(login "$member_email")
warm "$member"
echo "status $(api POST /api/account/delete "$member") member deletes account"
compare "T7 退会 (member 自身)" "$member"
