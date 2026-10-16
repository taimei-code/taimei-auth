#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT=poc/test-harness/out
FILES=(src/auth.ts package.json testing/compose.yml src/testing/routes.ts)
mkdir -p "$OUT/m2-orig"

case ${1:-} in
  apply)
    for f in "${FILES[@]}"; do mkdir -p "$OUT/m2-orig/$(dirname "$f")"; cp "$f" "$OUT/m2-orig/$f"; done
    perl -0pi -e 's|(        expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,\n)|$1        storeToken: "hashed",\n|' src/auth.ts
    perl -pi -e 's|process\.env\.AUTH_COOKIE_DOMAIN|process.env.AUTH_COOKIE_PARENT_DOMAIN|' src/auth.ts
    perl -pi -e 's|"db:migrate": |"db:migrate-core": |' package.json
    perl -pi -e 's|bun run db:migrate &&|bun run db:migrate-core \&\&|; s|AUTH_COOKIE_DOMAIN:|AUTH_COOKIE_PARENT_DOMAIN:|' testing/compose.yml
    perl -0pi -e 's|    identifier: token,\n|    identifier: Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("base64url"),\n|' src/testing/routes.ts
    git diff --stat -- src/auth.ts package.json
    grep -n "storeToken\|AUTH_COOKIE_PARENT_DOMAIN" src/auth.ts
    grep -n "migrate-core\|PARENT_DOMAIN" testing/compose.yml package.json
    grep -n "identifier:" src/testing/routes.ts
    ;;
  revert)
    for f in "${FILES[@]}"; do cp "$OUT/m2-orig/$f" "$f"; done
    git diff --stat -- src/auth.ts package.json
    ;;
  *) echo "usage: $0 apply|revert" >&2; exit 2 ;;
esac
