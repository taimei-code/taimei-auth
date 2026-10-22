#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
place="${1:?S1|S1p|S2|none}"; port=3199; n=10; seq_n=20
lsof -tiTCP:$port -sTCP:LISTEN | xargs -r kill; sleep 1
docker compose exec -T auth-postgres psql -U postgres -d auth -q -t < poc-318/clear-dev-accounts.sql >/dev/null
log=/tmp/poc318-seed-$place.log
(APP_POC_SEED=$place bash poc-318/start.sh testing/worker.ts $port > "$log" 2>&1 &)
for i in $(seq 1 60); do grep -q "Ready on" "$log" && break; sleep 1; done; sleep 1
url="http://localhost:$port/testing/v1/dev-home"
codes=$(for i in $(seq 1 $n); do curl -s -o /dev/null -w '%{http_code}\n' "$url" & done; wait)
echo "$place concurrent($n): $(echo "$codes" | sort | uniq -c | tr '\n' ' ')"
echo "$place rows: $(docker compose exec -T auth-postgres psql -U postgres -d auth -t -A -F, -c "SELECT (SELECT count(*) FROM \"user\" WHERE id LIKE 'dev-account-%'),(SELECT count(*) FROM membership WHERE user_id LIKE 'dev-account-%'),(SELECT count(*) FROM company WHERE id LIKE 'cmp_dev_company_%')") (users,memberships,companies; expected 3,5,2)"
times=$(for i in $(seq 1 $seq_n); do curl -s -o /dev/null -w '%{time_total}\n' "$url"; done | sort -n)
echo "$place sequential($seq_n) median_ms: $(echo "$times" | awk '{a[NR]=$1} END {printf "%.1f", (a[int((NR+1)/2)]+a[int(NR/2)+1])/2*1000}') min_ms: $(echo "$times" | head -1 | awk '{printf "%.1f",$1*1000}') max_ms: $(echo "$times" | tail -1 | awk '{printf "%.1f",$1*1000}')"
grep -iE "error|cannot|different request|hung|promise" "$log" | grep -v "SENTRY_DSN" | sort | uniq -c | head -5
