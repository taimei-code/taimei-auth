#!/usr/bin/env bash
set -euo pipefail
curl -s -o /dev/null -w "passkey $1 -> %{http_code}\n" -X POST http://auth.taimei-code.localhost:3100/testing/v1/feature-flags \
  -H 'content-type: application/json' -d "{\"flag\":\"passkey\",\"state\":\"$1\"}"
