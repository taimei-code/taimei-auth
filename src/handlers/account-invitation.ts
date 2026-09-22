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
import { parseZodBody, parseZodBodyWithDetails, roleBodySchema } from "./parse-body";
import { captureCause } from "../sentry";
import { runRoute } from "./run-route";

export const accountInvitation = new Hono();

const createInvitationBody = z
  .object({
    email: z.email().max(320),
    role: roleBodySchema,
  })
  .transform((d) => ({ email: d.email.toLowerCase(), role: d.role }));

const acceptInvitationBody = z
  .object({ invitation_token: z.string().min(1).max(256) })
  .transform((d) => ({ token: d.invitation_token }));

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

accountInvitation.post("/api/account/companies/:companyId/invitations", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const { actor, email, role } = yield* requireInvite({
        headers: c.req.raw.headers,
        companyId,
        parseBody: parseZodBodyWithDetails(c, createInvitationBody),
      });
      const result = yield* createInvitation({ actorUserId: actor.id, companyId, email, role });
      const invitationRow = result.invitation;

      // commit 後に background で送信し、200 をすぐ返す (DB の INSERT に失敗したときは送信しない)。
      const callbackURL = `${getAppUrl()}${acceptInvitationPath(invitationRow.token)}`;
      const authApi = yield* AuthApi;
      const background = yield* Background;
      yield* background.run(
        authApi
          .signInMagicLink({ email, callbackURL })
          .pipe(Effect.catch(captureCause({ tags: { handler: "accountInvitation" } }))),
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

// email の厳密な一致 (invitation.email === session.email) で、token を盗んで使う phishing を防ぐ。
accountInvitation.post("/api/account/accept-invitation", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const grant = yield* requireInvitationAccept({
        headers: c.req.raw.headers,
        parseBody: parseZodBody(c, acceptInvitationBody),
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
