import { buildAccountUrl, buildAuthLoginUrl } from "@taimei-code/auth-client";
import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import { Hono } from "hono";
import type { Context } from "hono";

import { captureCauseAs } from "../sentry";
import { checkSession } from "../session-check";
import { runRoute } from "./run-route";

const PASSTHROUGH_QUERY_KEYS = ["error"] as const;

const buildLoginRedirect = (url: URL): URL => {
  const target = new URL(
    buildAuthLoginUrl({
      authBaseUrl: url.origin,
      service: "accounts",
      returnTo: buildAccountUrl({ authBaseUrl: url.origin }),
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

export const loginShortcutProgram = Effect.fnUntraced(function* (c: Context) {
  const headers = c.req.raw.headers;
  const authenticated = getSessionCookie(headers)
    ? yield* checkSession(headers).pipe(
        Effect.map((status) => status._tag === "Active"),
        Effect.catchTag(
          ["AuthApiError", "DbError"],
          captureCauseAs(false, { tags: { handler: "loginShortcut" } }),
        ),
      )
    : false;

  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie");

  const url = new URL(c.req.url);
  return c.redirect(
    authenticated
      ? buildAccountUrl({ authBaseUrl: url.origin })
      : buildLoginRedirect(url).toString(),
    302,
  );
});

const handler = (c: Context) => runRoute(c, loginShortcutProgram(c));

export const loginShortcut = new Hono().get("/", handler).get("/login", handler);
