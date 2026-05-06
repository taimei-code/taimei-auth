import { Hono } from "hono";
import type { Context } from "hono";

import { Sentry } from "../sentry";

// taimei-auth 自身用ショートカット: GET /login と GET / で session 状態に応じた 302 を返す。
// freee-accounts の `/login` パスと UX を揃え、auth.taimei-code.com/login (および /) で
// アカウント管理 (/account) へのログインフローを起動する目的。session 有りなら /account 直行、
// 未認証なら共通ログイン画面へ。Layer B の SignIn 画面に Layer A 相当の役割を担わせる (sign 流: プロダクト側 URL 構築の自身版)。
//
// passthrough 対象クエリ: /auth/ 側で意味を持つ既知キーのみ (allowlist 方式)。
// 知らないクエリは破棄して /auth/ に渡らないようにする (パラメータ汚染防止)。
const PASSTHROUGH_QUERY_KEYS = ["error"] as const;

const buildLoginRedirect = (url: URL): URL => {
  const target = new URL(`${url.origin}/auth/`);
  target.searchParams.set("service_name", "accounts");
  target.searchParams.set("redirect_url", `${url.origin}/account`);

  for (const key of PASSTHROUGH_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      target.searchParams.set(key, value);
    }
  }

  return target;
};

// handler は session 有無 (boolean) のみ判断。better-auth の内部 shape を露出させない role interface。
export type IsAuthenticated = (headers: Headers) => Promise<boolean>;

export const buildLoginShortcut = (isAuthenticated: IsAuthenticated) => {
  const app = new Hono();

  const handler = async (c: Context) => {
    const url = new URL(c.req.url);

    const authenticated = await isAuthenticated(c.req.raw.headers).catch((err) => {
      // Redis transient 失敗を 5xx にせず、未認証扱いで共通ログイン画面に流す。Sentry warning として観測可能にしておく。
      Sentry.captureException(err, { level: "warning", tags: { handler: "loginShortcut" } });
      return false;
    });

    // 302 Location は session 状態 (Cookie) で分岐するため CDN/proxy の共有 cache 不可。session-leak 防止。
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie");

    if (authenticated) {
      return c.redirect(`${url.origin}/account`, 302);
    }
    return c.redirect(buildLoginRedirect(url).toString(), 302);
  };

  app.get("/", handler);
  app.get("/login", handler);

  return app;
};
