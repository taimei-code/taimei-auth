#!/usr/bin/env bash
# playwright webServer から起動される e2e 専用サーバ。
# - web/dist は CI に存在しないため毎回 build:web する
# - magic link は local 環境で console に出るため、stdout を e2e/.server.log へ写して spec が読む
# - AUTH_SERVICE_URL を 3110 に向けないと magic link の verify URL が compose (3100) を指す
set -euo pipefail
cd "$(dirname "$0")/.."

# vite define が build 時の APP_ENV を client bundle に焼き込む (未設定は production 扱いで
# SPA 側 allowlist が localhost を拒否する) ため、e2e build は明示的に development にする
APP_ENV=development bun run build:web
bun run e2e/seed.ts
: > e2e/.server.log

# MFA 暗号鍵は .env 未設定でも e2e が自走できるよう固定ダミーで補う (production と共有しない値。
# src/mfa/__tests__/helpers.ts の既定値と同一)
export MFA_TOTP_ENCRYPTION_KEYS="${MFA_TOTP_ENCRYPTION_KEYS:-v1:MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"

PORT=3110 AUTH_SERVICE_URL=http://localhost:3110 bun run src/index.ts 2>&1 | tee -a e2e/.server.log
