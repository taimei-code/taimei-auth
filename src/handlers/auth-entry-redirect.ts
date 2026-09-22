import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import type { Context, Next } from "hono";

import { AuthApi } from "../auth-service";
import { MembershipRepo } from "../membership/ports";
import { captureCauseAs } from "../sentry";
import { signInParamsSchema } from "../sign-in-params";
import { runMiddleware } from "./run-route";

// /auth/signup/company は含めない。含めると membership が 0 件の user が同じパスへ無限に redirect される。
const AUTH_ENTRY_PATHS = new Set(["/auth/", "/auth/signup"]);

export const authEntryRedirect = (c: Context, next: Next) => {
  const headers = c.req.raw.headers;
  if (!AUTH_ENTRY_PATHS.has(c.req.path) || !getSessionCookie(headers)) return next();
  return runMiddleware(c, next, authEntryRedirectProgram(c));
};

// 一時的な障害では 5xx を返さずそのまま通す (session に応じた redirect は利便のためで、認可ではない)。
export const authEntryRedirectProgram = Effect.fn("handlers.authEntryRedirect")(
  function* (c: Context) {
    const headers = c.req.raw.headers;
    const session = yield* AuthApi.use((authApi) => authApi.getSession(headers));
    if (!session) return undefined;

    const params = signInParamsSchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!params.success) return undefined;

    if (params.data.invitation_token) {
      const inviteUrl = new URL("/auth/signup/accept-invitation", c.req.url);
      inviteUrl.searchParams.set("invitation_token", params.data.invitation_token);
      return c.redirect(inviteUrl.pathname + inviteUrl.search);
    }

    const memberships = yield* MembershipRepo.use((repo) =>
      repo.findMembershipsByUserId(session.user.id),
    );
    const activeMemberships = memberships.filter((m) => m.companyActivationStatus === "ACTIVE");
    if (activeMemberships.length === 0) {
      const companyUrl = new URL("/auth/signup/company", c.req.url);
      companyUrl.searchParams.set("service_name", params.data.service_name);
      companyUrl.searchParams.set("redirect_url", params.data.redirect_url);
      return c.redirect(companyUrl.pathname + companyUrl.search);
    }

    return c.redirect(params.data.redirect_url);
  },
  Effect.catchTag(
    ["AuthApiError", "DbError"],
    captureCauseAs(undefined, { tags: { handler: "authEntryRedirect" } }),
  ),
);
