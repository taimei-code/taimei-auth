#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
export WRANGLER_SEND_METRICS=false
wrangler=node_modules/.bin/wrangler
expected_current="808e1112-9736-43af-a29b-1a39ca8c4665"
cookie_file="${1:-/tmp/poc-prod-cookie}"
rounds="${2:-100}"
result="/tmp/poc-v3-prod-result.json"
events="/tmp/poc-v3-prod-events.jsonl"
base="https://auth.taimei-code.com"

current=$($wrangler deployments status | sed -n 's/.*(100%) *//p' | tr -d '[:space:]')
[ "$current" = "$expected_current" ] || { echo "100% の version が想定と違う: $current" >&2; exit 1; }

cookie=$(tr -d '\n' < "$cookie_file" | tr ';' '\n' | sed 's/^ *//' | grep '^__Secure-better-auth.session_token=' | head -1)
[ -n "$cookie" ] || { echo "cookie に __Secure-better-auth.session_token が無い" >&2; exit 1; }
token=$(openssl rand -hex 32)

$wrangler versions upload --tag poc-v3-cpu --message "poc v3 cpu measurement (0%)" --var "POC_TOKEN:$token" > /tmp/poc-v3-upload.log 2>&1
version=$(sed -n 's/^Worker Version ID: *//p' /tmp/poc-v3-upload.log | tr -d '[:space:]')
[ -n "$version" ] || { echo "version id が取れない (/tmp/poc-v3-upload.log)" >&2; exit 1; }
echo "uploaded: $version"

restore() {
  $wrangler versions deploy "${expected_current}@100%" --yes --message "poc v3 cpu measurement restore" > /tmp/poc-v3-restore.log 2>&1 || true
  echo "restored: $($wrangler deployments status | grep -E '\(100%\)|\(0%\)' | tr -s ' ')"
}
trap restore EXIT

$wrangler versions deploy "${version}@0%" "${expected_current}@100%" --yes --message "poc v3 cpu measurement stage" > /tmp/poc-v3-stage.log 2>&1
echo "staged at 0%"

override="Cloudflare-Workers-Version-Overrides: taimei-auth=\"$version\""
call() {
  curl -sS --max-time 30 -o /dev/null -w '%{http_code}' -X POST "$base/poc/measure/$1" \
    -H "$override" -H "X-Poc-Token: $token" --data-binary "$cookie"
}

for _ in $(seq 1 30); do
  [ "$(call v3)" = 200 ] && break
  sleep 2
done
check=$(curl -sS --max-time 30 -X POST "$base/poc/measure/v3" -H "$override" -H "X-Poc-Token: $token" --data-binary "$cookie" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("_tag"), "companyId" if d.get("companyId") else "no-company", "members=%d" % len(d.get("members", [])), "role=%s" % d.get("role"))')
echo "session check: $check"
case "$check" in Verified*) ;; *) echo "session が Verified でない" >&2; exit 1 ;; esac

: > "$events"
$wrangler tail taimei-auth --format json 2>/dev/null | python3 "$root/poc/v3-production/tail_filter.py" > "$events" &
sleep 10

statuses=""
for _ in $(seq 1 "$rounds"); do
  statuses+="$(call v1-verify) $(call v1-list) $(call v3)"$'\n'
done
echo "statuses (v1-verify v1-list v3):"
printf "%s" "$statuses" | sort | uniq -c

sleep 15
pkill -f "wrangler tail taimei-auth" || true
sleep 1
python3 "$root/poc/v3-production/summarize.py" "$events" > "$result"
echo "events: $(wc -l < "$events" | tr -d ' ') -> $result"
