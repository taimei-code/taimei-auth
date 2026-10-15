#!/usr/bin/env bash
set -euo pipefail
label="$1"
root="$(cd "$(dirname "$0")/../.." && pwd)"
out="$root/poc/rpc-contract/dist/$label"
mkdir -p "$out"
cd "$root"
export WRANGLER_SEND_METRICS=false
node_modules/.bin/wrangler deploy --dry-run --outdir "$out" --metafile "$out/meta.json" > "$out/build.log" 2>&1
raw=$(wc -c < "$out/worker.js" | tr -d ' ')
gz=$(gzip -9 -c "$out/worker.js" | wc -c | tr -d ' ')
cpu=()
for i in 1 2 3; do
  node_modules/.bin/wrangler check startup --outfile "$out/startup-$i.cpuprofile" > "$out/startup-$i.log" 2>&1
  cpu+=("$(python3 "$root/poc/rpc-contract/startup_cpu.py" "$out/startup-$i.cpuprofile")")
done
proto=$(python3 "$root/poc/rpc-contract/proto_bytes.py" "$out/meta.json")
echo "$label raw=$raw gzip=$gz startup_ms=${cpu[*]} proto_connect_bytes_in_output=$proto"
