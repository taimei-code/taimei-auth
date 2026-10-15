import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import type { Context, Next } from "hono";

import { acceptInvitationPath } from "../invitation/accept-path";
import { MembershipRepo } from "../membership/ports";
import { captureCauseAs } from "../sentry";
import { checkSession } from "../session-check";
import { signInParamsSchema } from "../sign-in-params";
import { CONTINUE, respondWith, runMiddleware } from "./run-route";

const AUTH_ENTRY_PATHS = new Set(["/auth/", "/auth/signup"]);

export const authEntryRedirect = (c: Context, next: Next) => {
  const headers = c.req.raw.headers;
  if (!AUTH_ENTRY_PATHS.has(c.req.path) || !getSessionCookie(headers)) return next();
  return runMiddleware(c, next, authEntryRedirectProgram(c));
};

export const authEntryRedirectProgram = Effect.fnUntraced(
  function* (c: Context) {
    const headers = c.req.raw.headers;
    const params = signInParamsSchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!params.success) return CONTINUE;

    const status = yield* checkSession(headers);
    if (status._tag !== "Active") return CONTINUE;

    if (params.data.invitation_token) {
      return respondWith(c.redirect(acceptInvitationPath(params.data.invitation_token)));
    }

    const memberships = yield* MembershipRepo.use((repo) =>
      repo.findMembershipsByUserId(status.user.id),
    );
    const activeMemberships = memberships.filter((m) => m.companyActivationStatus === "ACTIVE");
    if (activeMemberships.length === 0) {
      const companyUrl = new URL("/auth/signup/company", c.req.url);
      companyUrl.searchParams.set("service_name", params.data.service_name);
      companyUrl.searchParams.set("redirect_url", params.data.redirect_url);
      return respondWith(c.redirect(companyUrl.pathname + companyUrl.search));
    }

    return respondWith(c.redirect(params.data.redirect_url));
  },
  Effect.catchTag(
    ["AuthApiError", "DbError"],
    captureCauseAs(CONTINUE, { tags: { handler: "authEntryRedirect" } }),
  ),
);
