#!/usr/bin/env bash
# playwright の webServer から起動される e2e 専用のサーバ。
# - web/dist は CI に存在しないため、毎回 build:web する
# - magic link は local 環境では console に出るため、stdout を e2e/.server.log へコピーして spec が読む
# - AUTH_SERVICE_URL を 3110 に向けないと、magic link の verify URL が compose (3100) を指してしまう
set -euo pipefail
cd "$(dirname "$0")/.."
# 以前の `bun run src/index.ts` は .env を自動で読んでいた。wrangler dev は --env-file しか読まないため、
# 明示的な export の前に .env を読む (下の export が優先される)。
if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  . ./.env
  set +a
fi

# vite の define が build 時の APP_ENV を client bundle に埋め込む (未設定だと production 扱いになり、
# SPA 側の allowlist が localhost を拒否する) ため、e2e の build では明示的に development にする
APP_ENV=development bun run build:web
bun run e2e/seed.ts
: > e2e/.server.log

# MFA の暗号鍵は、.env に無くても e2e が単独で動くよう固定ダミーで補う (production とは共有しない値で、
# src/mfa/__tests__/helpers.ts の既定値と同じ)
export MFA_TOTP_ENCRYPTION_KEYS="${MFA_TOTP_ENCRYPTION_KEYS:-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"

export APP_ENV=development APP_NAME="${APP_NAME:-taimei}" PORT=3110
export AUTH_SERVICE_URL=http://localhost:3110 AUTH_TRUSTED_ORIGINS=http://localhost:3110 AUTH_COOKIE_DOMAIN=
bash scripts/wrangler-dev.sh 2>&1 | tee -a e2e/.server.log
