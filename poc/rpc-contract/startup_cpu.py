import json
import sys

profile = json.load(open(sys.argv[1]))
excluded = {"(idle)", "(program)", "(garbage collector)"}
excluded_ids = {n["id"] for n in profile["nodes"] if n["callFrame"]["functionName"] in excluded}
deltas = profile["timeDeltas"]
total_us = sum(d for s, d in zip(profile["samples"], deltas[1:] + [0]) if s not in excluded_ids)
print(f"{total_us / 1000:.1f}")
