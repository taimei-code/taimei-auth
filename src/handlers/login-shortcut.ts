import { buildAuthLoginUrl } from "@taimei-code/auth-client";
import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import { Hono } from "hono";
import type { Context } from "hono";

import { AuthApi } from "../auth-service";
import { captureCauseAs } from "../sentry";
import { runRoute } from "./run-route";

const PASSTHROUGH_QUERY_KEYS = ["error"] as const;

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

export const loginShortcutProgram = Effect.fn("handlers.loginShortcut")(function* (c: Context) {
  const headers = c.req.raw.headers;
  const authenticated = getSessionCookie(headers)
    ? yield* AuthApi.use((authApi) => authApi.getSession(headers)).pipe(
        Effect.map((session) => session !== null),
        Effect.catchTag(
          "AuthApiError",
          captureCauseAs(false, { tags: { handler: "loginShortcut" } }),
        ),
      )
    : false;

  // 302 Location が Cookie で分岐するため CDN/proxy の共有 cache を禁止 (session-leak 防止)
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");

  const url = new URL(c.req.url);
  return c.redirect(
    authenticated ? `${url.origin}/account` : buildLoginRedirect(url).toString(),
    302,
  );
});

const handler = (c: Context) => runRoute(c, loginShortcutProgram(c));

export const loginShortcut = new Hono().get("/", handler).get("/login", handler);
