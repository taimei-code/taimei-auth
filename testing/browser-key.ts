import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

export const BROWSER_KEY_COOKIE = "testing_browser_key";
const LONGEST_COOKIE_AGE_BROWSERS_KEEP_SEC = 400 * 24 * 60 * 60;
const issuedBrowserKeySchema = z.uuid();

export const browserKeyOf = (c: Context) => {
  const parsed = issuedBrowserKeySchema.safeParse(getCookie(c, BROWSER_KEY_COOKIE));
  return parsed.success ? parsed.data : undefined;
};

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
