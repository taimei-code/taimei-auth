import { Hono } from "hono";
import { z } from "zod";

import { auth } from "../auth";
import { getSessionActor, getSessionActorId } from "./session-actor";
import { getAppUrl } from "../email/client";
import { runInTransaction } from "@/db/transaction";
import {
  findMembership,
  findMembersByCompanyId,
  generateMembershipId,
  insertMembership,
  type Role,
} from "@/db/repositories/membership";
import {
  findActivePendingInvitation,
  findInvitationByToken,
  generateInvitationId,
  generateInvitationToken,
  insertInvitation,
  isAcceptable,
  listPendingInvitations,
  markInvitationAccepted,
  markInvitationRevoked,
} from "@/db/repositories/invitation";
import {
  recordInvitationAccepted,
  recordInvitationRevoked,
  recordInvitationSent,
} from "@/db/repositories/audit-log";
import { incrInvitationRate } from "../invitation/rate-limit";

export const accountInvitation = new Hono();

const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // ADR-009: invitation は 24h 有効

const createInvitationBody = z.object({
  email: z.string().email().max(320),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
});

const acceptInvitationBody = z.object({
  invitation_token: z.string().min(1).max(256),
});

// OWNER / ADMIN のみメンバー管理可能 (MEMBER は不可)。
function canManageMembers(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

// GET メンバー一覧 (所属メンバーなら誰でも閲覧可)
accountInvitation.get("/api/account/companies/:companyId/members", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const companyId = c.req.param("companyId");

  const actorMembership = await findMembership(userId, companyId);
  if (!actorMembership) return c.json({ error: "forbidden" }, 403);

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
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const companyId = c.req.param("companyId");

  const actorMembership = await findMembership(userId, companyId);
  if (!actorMembership || !canManageMembers(actorMembership.role)) {
    return c.json({ error: "forbidden" }, 403);
  }

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

// POST 招待作成 (OWNER / ADMIN のみ)
accountInvitation.post("/api/account/companies/:companyId/invitations", async (c) => {
  const userId = await getSessionActorId(c.req.raw.headers);
  if (!userId) return c.json({ error: "unauthorized" }, 401);
  const companyId = c.req.param("companyId");

  const actorMembership = await findMembership(userId, companyId);
  if (!actorMembership || !canManageMembers(actorMembership.role)) {
    return c.json({ error: "forbidden" }, 403);
  }

  const parsed = createInvitationBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_argument", details: parsed.error.flatten() }, 400);
  }
  const email = parsed.data.email.toLowerCase();
  const role = parsed.data.role as Role;

  // idempotency check を rate limit より先に行う: 既存 PENDING への再送 (リマインド) は
  // 新規招待ではないため rate counter を消費しない。
  const existing = await findActivePendingInvitation(companyId, email);

  let invitationRow = existing;
  if (!invitationRow) {
    // 新規招待のみ rate limit を消費 (env tunable、Magic Link rate limit と二重防御)。
    const withinLimit = await incrInvitationRate(companyId);
    if (!withinLimit) {
      return c.json({ error: "rate_limited" }, 429);
    }
    invitationRow = await runInTransaction(async (tx) => {
      const row = await insertInvitation(
        {
          id: generateInvitationId(),
          companyId,
          email,
          role,
          token: generateInvitationToken(),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          invitedByUserId: userId,
        },
        tx,
      );
      await recordInvitationSent(
        {
          actor_user_id: userId,
          invitation_id: row.id,
          company_id: companyId,
          invited_email: email,
          role,
        },
        tx,
      );
      return row;
    });
  }

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
    reused: existing !== undefined,
  });
});

// POST 招待取消 (OWNER / ADMIN のみ)
accountInvitation.post(
  "/api/account/companies/:companyId/invitations/:invitationId/revoke",
  async (c) => {
    const userId = await getSessionActorId(c.req.raw.headers);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    const companyId = c.req.param("companyId");
    const invitationId = c.req.param("invitationId");

    const actorMembership = await findMembership(userId, companyId);
    if (!actorMembership || !canManageMembers(actorMembership.role)) {
      return c.json({ error: "forbidden" }, 403);
    }

    const revoked = await runInTransaction(async (tx) => {
      const row = await markInvitationRevoked(invitationId, companyId, tx);
      if (!row) return null;
      await recordInvitationRevoked(
        { actor_user_id: userId, invitation_id: row.id, company_id: companyId },
        tx,
      );
      return row;
    });

    if (!revoked) return c.json({ error: "not_found_or_not_pending" }, 404);
    return c.json({ ok: true });
  },
);

// POST 招待受諾。strict email match (invitation.email === session.email) で token 盗難に対する phishing 防御。
accountInvitation.post("/api/account/accept-invitation", async (c) => {
  const actor = await getSessionActor(c.req.raw.headers);
  if (!actor) return c.json({ error: "unauthorized" }, 401);

  const parsed = acceptInvitationBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: "invalid_argument" }, 400);
  }

  const invitation = await findInvitationByToken(parsed.data.invitation_token);
  if (!invitation) return c.json({ error: "not_found" }, 404);

  // email strict match (case-insensitive)。不一致は 403 (token 盗難で別人が accept するのを防ぐ)。
  if (invitation.email.toLowerCase() !== actor.email.toLowerCase()) {
    return c.json({ error: "email_mismatch" }, 403);
  }

  // 既に同 (user, company) の membership があれば最終状態は達成済 = idempotent success。
  // invitation は PENDING のままでも再 mark せず終える (初回 accept 時に audit 記録済)。
  const already = await findMembership(actor.id, invitation.companyId);
  if (already) {
    return c.json({ ok: true, company_id: invitation.companyId, reused: true });
  }

  if (!isAcceptable(invitation)) {
    // PENDING でない (accepted/revoked) or 期限切れ → 410 Gone
    return c.json({ error: "expired_or_used" }, 410);
  }

  // mark accepted (PENDING-guard) → membership INSERT → audit を 1 tx で atomic に。
  // markInvitationAccepted が 0 件更新なら別経路で既に accept/revoke 済 (race) → 410。
  const result = await runInTransaction(async (tx) => {
    const accepted = await markInvitationAccepted(invitation.id, tx);
    if (!accepted) return null;
    await insertMembership(
      {
        id: generateMembershipId(),
        userId: actor.id,
        companyId: invitation.companyId,
        role: invitation.role as Role,
      },
      tx,
    );
    await recordInvitationAccepted(
      {
        actor_user_id: actor.id,
        invitation_id: invitation.id,
        company_id: invitation.companyId,
        role: invitation.role as "OWNER" | "ADMIN" | "MEMBER",
      },
      tx,
    );
    return accepted;
  });

  if (!result) return c.json({ error: "expired_or_used" }, 410);
  return c.json({ ok: true, company_id: invitation.companyId });
});
