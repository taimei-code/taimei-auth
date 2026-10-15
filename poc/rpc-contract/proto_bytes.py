import json
import sys

meta = json.load(open(sys.argv[1]))
markers = (
    "@connectrpc",
    "@bufbuild",
    "src/gen/",
    "auth-client/src/gen",
    "auth-client/dist/gen",
    "src/rpc/fetch-handler",
    "src/rpc/routes",
)
total = 0
for output in meta["outputs"].values():
    for path, info in output.get("inputs", {}).items():
        if any(m in path for m in markers):
            total += info["bytesInOutput"]
print(total)
