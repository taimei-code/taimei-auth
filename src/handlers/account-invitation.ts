import { Hono } from "hono";
import { z } from "zod";

import { listPendingInvitations } from "@/db/repositories/invitation";
import { findMembersByCompanyId, type Role } from "@/db/repositories/membership";
import { auth } from "../auth";
import { getAppUrl } from "../email/client";
import { acceptInvitation } from "../invitation/accept";
import { createInvitation } from "../invitation/create";
import { revokeInvitation } from "../invitation/revoke";
import {
  guardErrorResponse,
  reasonToGuardError,
  requireInvitationAccept,
  requireInvite,
  requireMembership,
} from "../membership/guard";
import { parseZodBody } from "./parse-body";

export const accountInvitation = new Hono();

const createInvitationBody = z.object({
  email: z.string().email().max(320),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

const acceptInvitationBody = z.object({
  invitation_token: z.string().min(1).max(256),
});

// GET メンバー一覧 (所属メンバーなら誰でも閲覧可)
accountInvitation.get("/api/account/companies/:companyId/members", async (c) => {
  const companyId = c.req.param("companyId");
  const membershipResult = await requireMembership(c.req.raw.headers, companyId);
  if (!membershipResult.ok) return guardErrorResponse(membershipResult);

  const members = await findMembersByCompanyId(companyId);
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
});

// GET 招待中 (PENDING) 一覧 (OWNER / ADMIN のみ)
accountInvitation.get("/api/account/companies/:companyId/invitations", async (c) => {
  const companyId = c.req.param("companyId");
  const membershipResult = await requireMembership(c.req.raw.headers, companyId, "ADMIN");
  if (!membershipResult.ok) return guardErrorResponse(membershipResult);

  const invitations = await listPendingInvitations(companyId);
  return c.json({
    invitations: invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      expires_at: inv.expiresAt.toISOString(),
      created_at: inv.createdAt.toISOString(),
    })),
  });
});

// POST 招待作成 (OWNER / ADMIN のみ、canInviteRole で OWNER 招待は OWNER のみ)。
// 判定順は requireInvite entry に集約 (401 → 403 ADMIN → 400 with details → 403 canInviteRole)。
// idempotency (既存 PENDING 再送) / rate-limit / insert + audit は createInvitation use-case が所有。
// magic-link 送信は handler が post-commit で行う (accept 側と対称、DB 失敗時は無送信)。
accountInvitation.post("/api/account/companies/:companyId/invitations", async (c) => {
  const companyId = c.req.param("companyId");
  const guardResult = await requireInvite({
    headers: c.req.raw.headers,
    companyId,
    parseBody: parseZodBody(c, createInvitationBody, {
      withDetails: true,
      transform: (d) => ({ email: d.email.toLowerCase(), role: d.role as Role }),
    }),
  });
  if (!guardResult.ok) return guardErrorResponse(guardResult);
  const { actor, email, role } = guardResult;

  const result = await createInvitation({
    actorUserId: actor.id,
    companyId,
    email,
    role,
  });
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  const invitationRow = result.invitation;

  // commit 後にメール送信 (DB INSERT 成功してから送る、失敗時は無送信)。
  // signInMagicLink が magic link を発行 → sendMagicLink が invitation_token を検出して招待メールに分岐。
  const callbackURL = `${getAppUrl()}/auth/signup/accept-invitation?invitation_token=${invitationRow.token}`;
  await auth.api
    .signInMagicLink({ body: { email, callbackURL }, headers: new Headers() })
    .catch((e) => {
      console.error("failed to send invitation magic link", e);
    });

  return c.json({
    invitation: {
      id: invitationRow.id,
      email: invitationRow.email,
      role: invitationRow.role,
      expires_at: invitationRow.expiresAt.toISOString(),
    },
    reused: result.reused,
  });
});

// POST 招待取消 (OWNER / ADMIN のみ)。tx / audit は revokeInvitation use-case が所有。
accountInvitation.post(
  "/api/account/companies/:companyId/invitations/:invitationId/revoke",
  async (c) => {
    const companyId = c.req.param("companyId");
    const invitationId = c.req.param("invitationId");
    const membershipResult = await requireMembership(c.req.raw.headers, companyId, "ADMIN");
    if (!membershipResult.ok) return guardErrorResponse(membershipResult);

    const result = await revokeInvitation({
      actorUserId: membershipResult.actor.id,
      companyId,
      invitationId,
    });
    if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
    return c.json({ ok: true });
  },
);

// POST 招待受諾。strict email match (invitation.email === session.email) で token 盗難に対する phishing 防御。
// entry (requireInvitationAccept) が 401→400→404 (token)→403 (email_mismatch)→reused 短絡→410 の
// 判定を担い、accept mutation (PENDING guard / OWNER 招待の招待者再検証 / membership INSERT / audit)
// は acceptInvitation use-case が tx 所有で行う。
accountInvitation.post("/api/account/accept-invitation", async (c) => {
  const guardResult = await requireInvitationAccept({
    headers: c.req.raw.headers,
    parseBody: parseZodBody(c, acceptInvitationBody, {
      transform: (d) => ({ token: d.invitation_token }),
    }),
  });
  if (!guardResult.ok) return guardErrorResponse(guardResult);

  if (guardResult.mode === "reused") {
    return c.json({
      ok: true,
      company_id: guardResult.companyId,
      reused: true,
    });
  }

  const result = await acceptInvitation({
    actor: guardResult.actor,
    invitation: guardResult.invitation,
  });
  if (!result.ok) return guardErrorResponse(reasonToGuardError(result.reason));
  return c.json({ ok: true, company_id: result.companyId });
});
