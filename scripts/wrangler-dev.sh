#!/usr/bin/env bash
# wrangler dev は process の環境変数を worker の binding にしないため env-file で渡す。wrangler.jsonc の vars (本番値) は空でも必ず上書きする (集合の一致は src/__tests__/wrangler-dev-env.test.ts が固定)
set -euo pipefail
cd "$(dirname "$0")/.."

OVERRIDE_ALWAYS=(
  APP_ENV APP_NAME AUTH_SERVICE_URL AUTH_COOKIE_DOMAIN AUTH_TRUSTED_ORIGINS
  AUTH_FROM_EMAIL_MAGIC_LINK AUTH_FROM_EMAIL_WELCOME AUTH_FROM_EMAIL_INVITATION AUTH_FROM_EMAIL_SECURITY
)
PASS_THROUGH=(
  AUTH_SECRET AUTH_SERVICE_KEY AUTH_SERVICE_KEY_PREVIOUS AUTH_GITHUB_ID AUTH_GITHUB_SECRET
  AUTH_RESEND_KEY AUTH_SUPPORT_EMAIL AUTH_ABUSE_INFO_URL MFA_TOTP_ENCRYPTION_KEYS MFA_CHALLENGE_ENABLED
  INVITATION_HOURLY_LIMIT_PER_COMPANY BLOB_READ_WRITE_TOKEN SENTRY_DSN
)
database_url="${DATABASE_URL:-postgres://postgres:password@127.0.0.1:5435/auth}"
env_file="$PWD/.wrangler/dev.env"
mkdir -p .wrangler
: > "$env_file"
# single quote で囲まないと dotenv-expand が `$` を展開し、` #` 以降を落とす
for k in "${OVERRIDE_ALWAYS[@]}"; do printf "%s='%s'\n" "$k" "${!k:-}" >> "$env_file"; done
for k in "${PASS_THROUGH[@]}"; do [[ -z "${!k+set}" ]] || printf "%s='%s'\n" "$k" "${!k}" >> "$env_file"; done
printf "NON_PRODUCTION_DATABASE_URL='%s'\n" "$database_url" >> "$env_file"

export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$database_url"
export WRANGLER_SEND_METRICS=false

# --local-upstream が無いと routes の host (auth.taimei-code.com) が Origin に書き換わり、cookie 付きの POST が 403 になる
[[ -n "${AUTH_SERVICE_URL:-}" ]] || { echo "AUTH_SERVICE_URL が未設定 (--local-upstream の host に使う)" >&2; exit 2; }
upstream="${AUTH_SERVICE_URL#http://}"
upstream="${upstream#https://}"

exec bunx wrangler dev --ip 0.0.0.0 --port "${PORT:-3100}" --env-file "$env_file" --local-upstream "$upstream" "$@"
