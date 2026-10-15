import json
import sys
from urllib.parse import urlparse

decoder = json.JSONDecoder()
buffer = ""
for chunk in iter(lambda: sys.stdin.read(4096), ""):
    buffer += chunk
    while True:
        buffer = buffer.lstrip()
        if not buffer:
            break
        try:
            event, end = decoder.raw_decode(buffer)
        except json.JSONDecodeError:
            break
        buffer = buffer[end:]
        request = (event.get("event") or {}).get("request") or {}
        path = urlparse(request.get("url", "")).path
        if not path.startswith("/poc/measure/"):
            continue
        print(
            json.dumps(
                {
                    "mode": path.rsplit("/", 1)[-1],
                    "cpuTime": event.get("cpuTime"),
                    "wallTime": event.get("wallTime"),
                    "outcome": event.get("outcome"),
                    "status": ((event.get("event") or {}).get("response") or {}).get("status"),
                    "scriptVersion": (event.get("scriptVersion") or {}).get("id"),
                    "keys": sorted(event.keys()),
                }
            ),
            flush=True,
        )
