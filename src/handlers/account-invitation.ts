import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { AuthApi } from "../auth-service";
import { Background } from "../background";
import { getAppUrl } from "../email/client";
import { acceptInvitation } from "../invitation/accept";
import { acceptInvitationPath } from "../invitation/accept-path";
import { createInvitation } from "../invitation/create";
import { InvitationRepo } from "../invitation/ports";
import { revokeInvitation } from "../invitation/revoke";
import { requireInvitationAccept, requireInvite, requireMembership } from "../membership/guard";
import { MembershipRepo } from "../membership/ports";
import { parseZodBody, roleBodySchema } from "./parse-body";
import { runRoute } from "./run-route";

export const accountInvitation = new Hono();

const createInvitationBody = z.object({
  email: z.email().max(320),
  role: roleBodySchema,
});

const acceptInvitationBody = z.object({
  invitation_token: z.string().min(1).max(256),
});

// GET メンバー一覧 (所属メンバーなら誰でも閲覧可)
accountInvitation.get("/api/account/companies/:companyId/members", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      yield* requireMembership(c.req.raw.headers, companyId);
      const memberships = yield* MembershipRepo;
      const members = yield* memberships.findMembersByCompanyId(companyId);
      return c.json({
        members: members.map((m) => ({
          membership_id: m.membershipId,
          user_id: m.userId,
          user_name: m.userName,
          user_email: m.userEmail,
          role: m.role,
          joined_at: m.joinedAt.toISOString(),
        })),
      });
    }),
  ),
);

// GET 招待中 (PENDING) 一覧 (OWNER / ADMIN のみ)
accountInvitation.get("/api/account/companies/:companyId/invitations", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      yield* requireMembership(c.req.raw.headers, companyId, "ADMIN");
      const invitationRepo = yield* InvitationRepo;
      const invitations = yield* invitationRepo.listPendingInvitations(companyId);
      return c.json({
        invitations: invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          expires_at: inv.expiresAt.toISOString(),
          created_at: inv.createdAt.toISOString(),
        })),
      });
    }),
  ),
);

// POST 招待作成 (OWNER / ADMIN のみ、OWNER 招待は OWNER のみ)。判定順は requireInvite entry、idempotency /
// rate-limit / insert + audit は createInvitation use-case。magic-link 送信は handler が post-commit で行う。
accountInvitation.post("/api/account/companies/:companyId/invitations", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const { actor, email, role } = yield* requireInvite({
        headers: c.req.raw.headers,
        companyId,
        parseBody: parseZodBody(c, createInvitationBody, {
          withDetails: true,
          transform: (d) => ({ email: d.email.toLowerCase(), role: d.role }),
        }),
      });
      const result = yield* createInvitation({ actorUserId: actor.id, companyId, email, role });
      const invitationRow = result.invitation;

      // commit 後に送信する (DB INSERT 失敗時は無送信)。送信結果は response に載せないため、Resend の応答を
      // 待たず background へ逃がして 200 を即返す (Workers は ctx.waitUntil で完走保証、src/background.ts)。
      const callbackURL = `${getAppUrl()}${acceptInvitationPath(invitationRow.token)}`;
      const authApi = yield* AuthApi;
      const background = yield* Background;
      yield* background.run(
        authApi
          .signInMagicLink({ email, callbackURL })
          .pipe(
            Effect.catch((failure) =>
              Effect.logError("failed to send invitation magic link", failure.cause),
            ),
          ),
      );

      return c.json({
        invitation: {
          id: invitationRow.id,
          email: invitationRow.email,
          role: invitationRow.role,
          expires_at: invitationRow.expiresAt.toISOString(),
        },
        reused: result.reused,
      });
    }),
  ),
);

// POST 招待取消 (OWNER / ADMIN のみ)。tx / audit は revokeInvitation use-case が所有。
accountInvitation.post("/api/account/companies/:companyId/invitations/:invitationId/revoke", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const invitationId = c.req.param("invitationId");
      const { actor } = yield* requireMembership(c.req.raw.headers, companyId, "ADMIN");
      yield* revokeInvitation({ actorUserId: actor.id, companyId, invitationId });
      return c.json({ ok: true });
    }),
  ),
);

// POST 招待受諾。strict email match (invitation.email === session.email) で token 盗難の phishing を防ぐ。
// 判定順は entry (requireInvitationAccept)、accept mutation は acceptInvitation use-case が tx 所有で行う。
accountInvitation.post("/api/account/accept-invitation", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const grant = yield* requireInvitationAccept({
        headers: c.req.raw.headers,
        parseBody: parseZodBody(c, acceptInvitationBody, {
          transform: (d) => ({ token: d.invitation_token }),
        }),
      });
      if (grant.mode === "reused") {
        return c.json({ ok: true, company_id: grant.companyId, reused: true });
      }
      const result = yield* acceptInvitation({
        actor: grant.actor,
        invitation: grant.invitation,
      });
      return c.json({ ok: true, company_id: result.companyId });
    }),
  ),
);
