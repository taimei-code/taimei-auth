#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
entry="${1:?entry}"; port="${2:?port}"
requested_app_env="${APP_ENV:-development}"
if [[ -f .env ]]; then set -a; . ./.env; set +a; fi
export MFA_TOTP_ENCRYPTION_KEYS="${MFA_TOTP_ENCRYPTION_KEYS:-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"
export APP_ENV="$requested_app_env" APP_NAME=taimei PORT="$port"
export AUTH_SERVICE_URL="http://localhost:$port" AUTH_TRUSTED_ORIGINS="http://localhost:$port" AUTH_COOKIE_DOMAIN=
exec bash scripts/wrangler-dev.sh "$entry"
