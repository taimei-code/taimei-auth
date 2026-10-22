#!/usr/bin/env bash
set -euo pipefail
base="${1:?base url}"; home="${2:-/testing/v1/dev-home}"
jar=$(mktemp)
session_user() { curl -s -b "$jar" "$base/api/auth/get-session" | bun -e 'const t=await Bun.stdin.text(); const j=t?JSON.parse(t):null; console.log(j?.user?.id ?? "null")'; }
sign_in() {
  local loc
  loc=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$jar" -c "$jar" -H "Origin: $base" -X POST --data "userId=$1" "$base$home/sign-in")
  echo "  sign-in 303 -> ${loc%%\?*}"
  curl -s -o /dev/null -w '  verify %{http_code} -> %{redirect_url}\n' -b "$jar" -c "$jar" "$loc"
}
echo "0 before: $(session_user)"
curl -s -b "$jar" "$base$home" | grep -o 'ログインしていません\|data-signed-in-user-id="[^"]*"' | head -1
echo "1 sign in as dev-account-owner"; sign_in dev-account-owner
echo "2 session: $(session_user)"
curl -s -b "$jar" "$base$home" | grep -o 'data-signed-in-user-id="[^"]*"' | head -1
echo "3 switch to dev-account-member"; sign_in dev-account-member
echo "  session: $(session_user)"
curl -s -b "$jar" "$base$home" | grep -o 'data-signed-in-user-id="[^"]*"' | head -1
echo "4 sign out"
curl -s -o /dev/null -w '  sign-out %{http_code} -> %{redirect_url}\n' -b "$jar" -c "$jar" -H "Origin: $base" -X POST "$base$home/sign-out"
echo "  session: $(session_user)"
curl -s -b "$jar" "$base$home" | grep -o 'ログインしていません\|data-signed-in-user-id="[^"]*"' | head -1
rm -f "$jar"
