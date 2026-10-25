#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# wrangler dev は .env を読まない (下の export が優先される)
if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
fi

bun run build:web:non-production
bun run e2e/seed.ts
: > e2e/.server.log

# src/__tests__/test-env.ts の既定値と同じダミー鍵
export MFA_TOTP_ENCRYPTION_KEYS="${MFA_TOTP_ENCRYPTION_KEYS:-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"

export APP_ENV=development APP_NAME="${APP_NAME:-taimei}" PORT=3110
export AUTH_SERVICE_URL=http://localhost:3110 AUTH_TRUSTED_ORIGINS=http://localhost:3110 AUTH_COOKIE_DOMAIN=
export AUTH_SERVICE_KEY="${AUTH_SERVICE_KEY:-e2e-service-key}"
bash scripts/wrangler-dev.sh --config testing/wrangler.jsonc --define TAIMEI_AUTH_E2E_LOGIN_LINKS:true 2>&1 | tee -a e2e/.server.log
