#!/usr/bin/env bash
# compose / e2e 用の local 起動。wrangler dev は process の環境変数を worker の binding にしないため、
# 環境変数を env-file に写して渡す。wrangler.jsonc の vars (本番値) は空でも必ず上書きする。
set -euo pipefail
cd "$(dirname "$0")/.."

OVERRIDE_ALWAYS=(
  APP_ENV APP_NAME AUTH_SERVICE_URL AUTH_COOKIE_DOMAIN AUTH_TRUSTED_ORIGINS
  AUTH_FROM_EMAIL_MAGIC_LINK AUTH_FROM_EMAIL_WELCOME AUTH_FROM_EMAIL_INVITATION AUTH_FROM_EMAIL_SECURITY
)
FORWARD_IF_SET=(
  AUTH_SECRET AUTH_SERVICE_KEY AUTH_SERVICE_KEY_PREVIOUS AUTH_TRUSTED_PROXY_HOPS
  MFA_TOTP_ENCRYPTION_KEYS INVITATION_HOURLY_LIMIT_PER_COMPANY AUTH_RESEND_KEY
  AUTH_GITHUB_ID AUTH_GITHUB_SECRET AUTH_SUPPORT_EMAIL AUTH_ABUSE_INFO_URL BLOB_READ_WRITE_TOKEN SENTRY_DSN
)

env_file="$(mktemp)"
for k in "${OVERRIDE_ALWAYS[@]}"; do printf '%s=%s\n' "$k" "${!k:-}" >> "$env_file"; done
for k in "${FORWARD_IF_SET[@]}"; do
  if [[ -n "${!k:-}" ]]; then printf '%s=%s\n' "$k" "${!k}" >> "$env_file"; fi
done

export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="${DATABASE_URL:-postgres://postgres:password@127.0.0.1:5435/auth}"
export WRANGLER_SEND_METRICS=false

# --local-upstream が無いと routes の host (auth.taimei-code.com) が Origin に書き換わり cookie 付き POST が 403 になる。
upstream="${AUTH_SERVICE_URL#http://}"
upstream="${upstream#https://}"

exec bunx wrangler dev --ip 0.0.0.0 --port "${PORT:-3100}" --env-file "$env_file" --local-upstream "$upstream" "$@"
