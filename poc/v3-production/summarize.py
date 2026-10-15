import json
import math
import statistics
import sys

rows = [json.loads(line) for line in open(sys.argv[1]) if line.strip()]
by_mode = {}
for row in rows:
    by_mode.setdefault(row["mode"], []).append(row)


def nearest_rank(values, p):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(p / 100 * len(ordered)) - 1)]


summary = {"eventKeys": sorted({k for r in rows for k in r.get("keys", [])})}
for mode, items in sorted(by_mode.items()):
    cpu = [r["cpuTime"] for r in items if isinstance(r["cpuTime"], (int, float))]
    wall = [r["wallTime"] for r in items if isinstance(r["wallTime"], (int, float))]
    outcomes = {}
    for r in items:
        outcomes[r["outcome"]] = outcomes.get(r["outcome"], 0) + 1
    summary[mode] = {
        "n": len(items),
        "outcomes": outcomes,
        "statuses": sorted({r["status"] for r in items if r["status"] is not None}),
        "versions": sorted({r["scriptVersion"] for r in items if r["scriptVersion"]}),
        "cpu": {
            "p50": statistics.median(cpu),
            "p90": nearest_rank(cpu, 90),
            "max": max(cpu),
        }
        if cpu
        else None,
        "wall": {"p50": statistics.median(wall), "p90": nearest_rank(wall, 90)} if wall else None,
    }
print(json.dumps(summary, indent=1))
