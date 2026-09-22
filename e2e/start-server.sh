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

# vite の define が build 時の APP_ENV を埋め込む (未設定は production 扱いで localhost を拒否する)
APP_ENV=development bun run build:web
bun run e2e/seed.ts
: > e2e/.server.log

# src/mfa/__tests__/helpers.ts の既定値と同じダミー鍵
export MFA_TOTP_ENCRYPTION_KEYS="${MFA_TOTP_ENCRYPTION_KEYS:-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"

export APP_ENV=development APP_NAME="${APP_NAME:-taimei}" PORT=3110
export AUTH_SERVICE_URL=http://localhost:3110 AUTH_TRUSTED_ORIGINS=http://localhost:3110 AUTH_COOKIE_DOMAIN=
bash scripts/wrangler-dev.sh 2>&1 | tee -a e2e/.server.log
