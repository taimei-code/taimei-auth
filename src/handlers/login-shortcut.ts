import { Hono } from "hono";
import type { Context } from "hono";
import { buildAuthLoginUrl } from "@taimei-code/auth-client";

import { Sentry } from "../sentry";

// 未知のクエリは破棄し、allowlist 経由のみ /auth/ に渡す (パラメータ汚染防止)
const PASSTHROUGH_QUERY_KEYS = ["error"] as const;

// ログイン URL の組み立ては SDK の buildAuthLoginUrl に委ねる (キー名 typo / 順序の揺らぎを
// consumer と host で同じ 1 箇所に集約)。error の転記だけが本 handler 固有。
const buildLoginRedirect = (url: URL): URL => {
  const target = new URL(
    buildAuthLoginUrl({
      authBaseUrl: url.origin,
      service: "accounts",
      returnTo: `${url.origin}/account`,
    }),
  );

  for (const key of PASSTHROUGH_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      target.searchParams.set(key, value);
    }
  }

  return target;
};

export type IsAuthenticated = (headers: Headers) => Promise<boolean>;

export const buildLoginShortcut = (isAuthenticated: IsAuthenticated) => {
  const app = new Hono();

  const handler = async (c: Context) => {
    const url = new URL(c.req.url);

    const authenticated = await isAuthenticated(c.req.raw.headers).catch((err) => {
      // Redis transient 失敗は 5xx にせず未認証扱いで共通ログイン画面に流す。Sentry warning で観測のみ
      Sentry.captureException(err, { level: "warning", tags: { handler: "loginShortcut" } });
      return false;
    });

    // 302 Location が Cookie で分岐するため CDN/proxy の共有 cache を禁止 (session-leak 防止)
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
