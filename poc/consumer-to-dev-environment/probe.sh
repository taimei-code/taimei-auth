#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/consumer" || exit 1
docker compose -p poc-consumer -f docker-compose.yml "$@" run --rm --no-deps application 2>&1 \
  | grep -o '"health":[0-9]*\|"passkeyAvailability":{[^}]*}\|"loginStatus":[0-9]*\|"session":{"ok":[a-z]*\|ECONNREFUSED\|ENOTFOUND' | tr '\n' ' '
echo
