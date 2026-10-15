#!/usr/bin/env bash
set -euo pipefail
url="$1"
calls="$2"
snap() { for p in $(pgrep -f workerd); do printf "%s %s\n" "$p" "$(ps -o cputime= -p "$p" | tr -d ' ')"; done; }
before="$(snap)"
body="$(curl -s -m 600 "$url")"
after="$(snap)"
python3 - "$before" "$after" "$calls" "$body" <<'EOF'
import json
import sys

def parse(text):
    out = {}
    for line in text.strip().splitlines():
        pid, t = line.split()
        sec = 0.0
        for part in t.split(":"):
            sec = sec * 60 + float(part)
        out[pid] = sec
    return out

before, after, calls = parse(sys.argv[1]), parse(sys.argv[2]), int(sys.argv[3])
deltas = {pid: round((after[pid] - before.get(pid, 0)) / calls * 1000, 3) for pid in after}
print(json.dumps({"msPerCallByPid": {k: v for k, v in deltas.items() if v > 0}, "body": sys.argv[4][:160]}))
EOF
