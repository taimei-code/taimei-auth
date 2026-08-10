import type { Context, Next } from "hono";
import { getSessionCookie } from "better-auth/cookies";

import { auth } from "../auth";
import { signInParamsSchema } from "../sign-in-params";
import { findMembershipsByUserId } from "@/db/repositories/membership";

// /auth/signup/company は意図的に含めない。含めると membership 0 件 user が
// /auth/signup/company → (membership 0 件判定) → /auth/signup/company の無限 redirect ループになる。
// 事業所登録 page 自身の guard は SPA 側 (web/src/pages/SignUpCompany.tsx) が担う。
const AUTH_ENTRY_PATHS = new Set(["/auth/", "/auth/signup"]);

// 認証後の最終 redirect 先で「事業所未確定」(membership 0 件) なら /auth/signup/company に強制誘導する。
// /auth/, /auth/signup の認証済 fallback に既存挙動を維持しつつ、membership 0 件のみ別 path に分岐。
export const authEntryRedirect = async (c: Context, next: Next) => {
  if (!AUTH_ENTRY_PATHS.has(c.req.path)) return next();

  const headers = c.req.raw.headers;
  if (!getSessionCookie(headers)) return next();

  const session = await auth.api.getSession({ headers });
  if (!session) return next();

  const params = signInParamsSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
  if (!params.success) return next();

  // invitation 経由 (Phase B) は accept handler に直接 redirect (会社作成 UI を skip)。
  if (params.data.invitation_token) {
    const inviteUrl = new URL("/auth/signup/accept-invitation", c.req.url);
    inviteUrl.searchParams.set("invitation_token", params.data.invitation_token);
    return c.redirect(inviteUrl.pathname + inviteUrl.search);
  }

  const memberships = await findMembershipsByUserId(session.user.id);
  const activeMemberships = memberships.filter((m) => m.companyActivationStatus === "ACTIVE");
  if (activeMemberships.length === 0) {
    const companyUrl = new URL("/auth/signup/company", c.req.url);
    companyUrl.searchParams.set("service_name", params.data.service_name);
    companyUrl.searchParams.set("redirect_url", params.data.redirect_url);
    return c.redirect(companyUrl.pathname + companyUrl.search);
  }

  return c.redirect(params.data.redirect_url);
};
