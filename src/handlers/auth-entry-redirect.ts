import type { Context, Next } from "hono";
import { getSessionCookie } from "better-auth/cookies";

import { auth } from "../auth";
import { signInParamsSchema } from "../sign-in-params";

const AUTH_ENTRY_PATHS = new Set(["/auth/", "/auth/signup"]);

export const authEntryRedirect = async (c: Context, next: Next) => {
  if (!AUTH_ENTRY_PATHS.has(c.req.path)) return next();

  const headers = c.req.raw.headers;
  if (!getSessionCookie(headers)) return next();

  const session = await auth.api.getSession({ headers });
  if (!session) return next();

  const params = signInParamsSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!params.success) return next();

  return c.redirect(params.data.redirect_url);
};
