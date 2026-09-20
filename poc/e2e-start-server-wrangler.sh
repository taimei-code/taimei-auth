#!/usr/bin/env bash
# PoC (候補 A): e2e/start-server.sh の `bun run src/index.ts` を wrangler dev (miniflare + DO) に置き換えた版。
# 使い方: PLAYWRIGHT_WEB_SERVER_CMD 相当として playwright.config.ts の webServer.command をこのファイルに向ける。
set -euo pipefail
cd "$(dirname "$0")/.."

APP_ENV=development bun run build:web
bun run e2e/seed.ts
: > e2e/.server.log

# wrangler dev は routes の host (auth.taimei-code.com) を Origin に書き換えるため trusted origins に両方入れる。
cat > poc/.e2e.dev.env <<EOF
APP_ENV=development
APP_NAME=taimei
AUTH_SERVICE_URL=http://localhost:3110
AUTH_COOKIE_DOMAIN=
AUTH_TRUSTED_ORIGINS=http://localhost:3110,http://auth.taimei-code.com
AUTH_SECRET=dev-secret-for-local-development-32chars
AUTH_SERVICE_KEY=local-dev-key
AUTH_TRUSTED_PROXY_HOPS=0
MFA_TOTP_ENCRYPTION_KEYS=${MFA_TOTP_ENCRYPTION_KEYS:-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}
AUTH_FROM_EMAIL_MAGIC_LINK=
AUTH_FROM_EMAIL_WELCOME=
AUTH_FROM_EMAIL_INVITATION=
AUTH_FROM_EMAIL_SECURITY=
EOF

bunx wrangler dev --port 3110 --env-file poc/.e2e.dev.env 2>&1 | tee -a e2e/.server.log
