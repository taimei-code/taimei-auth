import { Hono } from "hono";

// taimei-auth 自身用ショートカット: GET /login → /auth/?service_name=accounts&redirect_url=<auth>/account に内部 302。
// freee-accounts の `/login` パスと UX を揃え、auth.taimei-code.com/login で
// アカウント管理 (/account) へのログインフローを起動する目的。URL 構築は本 handler 側で完結し
// Layer B の SignIn 画面に Layer A 相当の役割を担わせる (sign 流: プロダクト側 URL 構築の自身版)。
//
// passthrough 対象クエリ: /auth/ 側で意味を持つ既知キーのみ (allowlist 方式)。
// 知らないクエリは破棄して /auth/ に渡らないようにする (パラメータ汚染防止)。
const PASSTHROUGH_QUERY_KEYS = ["error", "disable_common_login"] as const;

export const loginShortcut = new Hono();

loginShortcut.get("/login", (c) => {
  const url = new URL(c.req.url);
  const target = new URL(`${url.origin}/auth/`);

  target.searchParams.set("service_name", "accounts");
  target.searchParams.set("redirect_url", `${url.origin}/account`);

  for (const key of PASSTHROUGH_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      target.searchParams.set(key, value);
    }
  }

  return c.redirect(target.toString(), 302);
});
