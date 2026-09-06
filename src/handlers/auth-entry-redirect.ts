import { getSessionCookie } from "better-auth/cookies";
import { Effect } from "effect";
import type { Context, Next } from "hono";

import { AuthApi } from "../auth-service";
import { MembershipRepo } from "../membership/ports";
import { captureCause, type SentryService } from "../sentry";
import { signInParamsSchema } from "../sign-in-params";
import type { RouteError } from "./wire-error";
import { runMiddleware } from "./run-route";

// /auth/signup/company は意図的に含めない。含めると membership 0 件 user が同 path へ無限 redirect する。
// 事業所登録 page 自身の guard は SPA 側が担う。
const AUTH_ENTRY_PATHS = new Set(["/auth/", "/auth/signup"]);

// 認証後の redirect 先で「事業所未確定」(membership 0 件) なら /auth/signup/company に強制誘導する。
// /auth/* 全体に mount されるため、対象 path と cookie の同期判定は runtime に入る前に済ませ、静的 asset の
// request に fiber を割かない。本体は Effect program (Auth service 経由)、runMiddleware が undefined → next() /
// Response → 短絡に写像する。
export const authEntryRedirect = (c: Context, next: Next) => {
  const headers = c.req.raw.headers;
  if (!AUTH_ENTRY_PATHS.has(c.req.path) || !getSessionCookie(headers)) return next();
  return runMiddleware(c, next, authEntryRedirectProgram(c));
};

const passThrough = (failure: {
  readonly cause: unknown;
}): Effect.Effect<undefined, never, SentryService> =>
  captureCause({ tags: { handler: "authEntryRedirect" } })(failure).pipe(Effect.as(undefined));

// Redis / better-auth / DB の transient 障害は 5xx にせず pass-through (SPA を返す) に倒す。login-shortcut と同じ
// fail-open 方針で、session-aware redirect は利便で認可ではない。Sentry には warning で残す。
export const authEntryRedirectProgram = (
  c: Context,
): Effect.Effect<Response | undefined, RouteError, AuthApi | MembershipRepo | SentryService> =>
  Effect.gen(function* () {
    const headers = c.req.raw.headers;
    const authApi = yield* AuthApi;
    const session = yield* authApi.getSession(headers);
    if (!session) return undefined;

    const params = signInParamsSchema.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams),
    );
    if (!params.success) return undefined;

    // invitation 経由 (Phase B) は accept handler に直接 redirect (会社作成 UI を skip)。
    if (params.data.invitation_token) {
      const inviteUrl = new URL("/auth/signup/accept-invitation", c.req.url);
      inviteUrl.searchParams.set("invitation_token", params.data.invitation_token);
      return c.redirect(inviteUrl.pathname + inviteUrl.search);
    }

    const membershipRepo = yield* MembershipRepo;
    const memberships = yield* membershipRepo.findMembershipsByUserId(session.user.id);
    const activeMemberships = memberships.filter((m) => m.companyActivationStatus === "ACTIVE");
    if (activeMemberships.length === 0) {
      const companyUrl = new URL("/auth/signup/company", c.req.url);
      companyUrl.searchParams.set("service_name", params.data.service_name);
      companyUrl.searchParams.set("redirect_url", params.data.redirect_url);
      return c.redirect(companyUrl.pathname + companyUrl.search);
    }

    return c.redirect(params.data.redirect_url);
  }).pipe(Effect.catchTags({ AuthApiError: passThrough, DbError: passThrough }));
