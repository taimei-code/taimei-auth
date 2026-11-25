import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Option, Schema } from "effect";

export const BROWSER_KEY_COOKIE = "testing_browser_key";
const LONGEST_COOKIE_AGE_BROWSERS_KEEP_SEC = 400 * 24 * 60 * 60;
const decodeIssuedBrowserKey = Schema.decodeUnknownOption(Schema.String.check(Schema.isUUID()));

export const browserKeyOf = (c: Context) =>
  Option.getOrUndefined(decodeIssuedBrowserKey(getCookie(c, BROWSER_KEY_COOKIE)));

export const browserKeyIssuedIfMissing = (c: Context) => {
  const existing = browserKeyOf(c);
  if (existing !== undefined) return existing;
  const issued = crypto.randomUUID();
  setCookie(c, BROWSER_KEY_COOKIE, issued, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: LONGEST_COOKIE_AGE_BROWSERS_KEEP_SEC,
  });
  return issued;
};
