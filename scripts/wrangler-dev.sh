#!/usr/bin/env bash
# compose / e2e 用の local 起動。wrangler dev は process の環境変数を worker の binding にしないため、
# 環境変数を env-file に写して渡す。wrangler.jsonc の vars (本番値) は空でも必ず上書きする
# (集合の一致は src/__tests__/wrangler-dev-env.test.ts が固定する)。
set -euo pipefail
cd "$(dirname "$0")/.."

OVERRIDE_ALWAYS=(
  APP_ENV APP_NAME AUTH_SERVICE_URL AUTH_COOKIE_DOMAIN AUTH_TRUSTED_ORIGINS
  AUTH_FROM_EMAIL_MAGIC_LINK AUTH_FROM_EMAIL_WELCOME AUTH_FROM_EMAIL_INVITATION AUTH_FROM_EMAIL_SECURITY
)
env_file=".wrangler/dev.env"
mkdir -p .wrangler
: > "$env_file"
# 値は single quote で囲む (dotenv-expand が `$` を展開し ` #` 以降を落とすため)。
for k in "${OVERRIDE_ALWAYS[@]}"; do printf "%s='%s'\n" "$k" "${!k:-}" >> "$env_file"; done
while IFS='=' read -r k v; do printf "%s='%s'\n" "$k" "$v" >> "$env_file"; done < <(env | grep -E '^(APP_|AUTH_|MFA_|INVITATION_|BLOB_|SENTRY_)[A-Z0-9_]*=' || true)

export WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="${DATABASE_URL:-postgres://postgres:password@127.0.0.1:5435/auth}"
export WRANGLER_SEND_METRICS=false

# --local-upstream が無いと routes の host (auth.taimei-code.com) が Origin に書き換わり cookie 付き POST が 403 になる。
[[ -n "${AUTH_SERVICE_URL:-}" ]] || { echo "AUTH_SERVICE_URL が未設定 (--local-upstream の host に使う)" >&2; exit 2; }
upstream="${AUTH_SERVICE_URL#http://}"
upstream="${upstream#https://}"

exec bunx wrangler dev --ip 0.0.0.0 --port "${PORT:-3100}" --env-file "$env_file" --local-upstream "$upstream" "$@"
