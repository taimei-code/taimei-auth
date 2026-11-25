import { buildCompanySignupUrl } from "@taimei-code/auth-client";
import { sessionCookieOf } from "../session-cookie";
import { Effect, Option, Schema } from "effect";
import type { Context, Next } from "hono";

import { acceptInvitationPath } from "../invitation/accept-path";
import { MembershipRepo } from "../membership/ports";
import { captureCauseAs } from "../sentry";
import { checkSession } from "../session-check";
import { SignInParams } from "../sign-in-params";
import { CONTINUE, respondWith, runMiddleware } from "./run-route";

const AUTH_ENTRY_PATHS = new Set(["/auth/", "/auth/signup"]);
const decodeSignInParams = Schema.decodeUnknownOption(SignInParams);

export const authEntryRedirect = (c: Context, next: Next) => {
  const headers = c.req.raw.headers;
  if (!AUTH_ENTRY_PATHS.has(c.req.path) || !sessionCookieOf(headers)) return next();
  return runMiddleware(c, next, authEntryRedirectProgram(c));
};

export const authEntryRedirectProgram = Effect.fnUntraced(
  function* (c: Context) {
    const headers = c.req.raw.headers;
    const requestUrl = new URL(c.req.url);
    const decoded = decodeSignInParams(Object.fromEntries(requestUrl.searchParams));
    if (Option.isNone(decoded)) return CONTINUE;
    const params = decoded.value;

    const status = yield* checkSession(headers);
    if (status._tag !== "Active") return CONTINUE;

    if (params.invitation_token) {
      return respondWith(c.redirect(acceptInvitationPath(params.invitation_token)));
    }

    const activeMembershipCount = yield* MembershipRepo.use((repo) =>
      repo.countActiveMembershipsByUserId(status.user.id),
    );
    if (activeMembershipCount === 0) {
      const { pathname, search } = new URL(
        buildCompanySignupUrl({
          authBaseUrl: requestUrl.origin,
          service: params.service_name,
          returnTo: params.redirect_url,
        }),
      );
      return respondWith(c.redirect(pathname + search));
    }

    return respondWith(c.redirect(params.redirect_url));
  },
  Effect.catchTag(
    ["AuthApiError", "DbError"],
    captureCauseAs(CONTINUE, { tags: { handler: "authEntryRedirect" } }),
  ),
);
