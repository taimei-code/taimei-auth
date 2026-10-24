import { Effect } from "effect";
import type { Hono } from "hono";
import { addBrowserAccount } from "../../db/testing/dev-accounts";
import { TestDb } from "../../src/__tests__/test-db";
import { BROWSER_KEY_COOKIE } from "../browser-key";

export const withCookies = (headers: HeadersInit | undefined, cookies: Record<string, string>) => {
  const merged = new Headers(headers);
  const pairs = Object.entries(cookies).map(([name, value]) => `${name}=${value}`);
  merged.set("cookie", [merged.get("cookie"), ...pairs].filter(Boolean).join("; "));
  return merged;
};

export const inBrowser = (browserKey: string, headers?: HeadersInit) =>
  new Headers(headers).get("cookie")?.includes(`${BROWSER_KEY_COOKIE}=`)
    ? new Headers(headers)
    : withCookies(headers, { [BROWSER_KEY_COOKIE]: browserKey });

export const requestInBrowser =
  (app: Pick<Hono, "request">, browserKey: string) => (path: string, init?: RequestInit) =>
    Promise.resolve(app.request(path, { ...init, headers: inBrowser(browserKey, init?.headers) }));

export const seedBrowserAccount = (
  browserKey: string,
  suffix: string,
  options?: { name?: string; email?: string },
) =>
  Effect.gen(function* () {
    const user = yield* TestDb.use((db) => db.seedUser(suffix, options));
    yield* Effect.promise(() => addBrowserAccount(browserKey, user.id));
    return user;
  });
