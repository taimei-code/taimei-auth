import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { AuthApi } from "../auth-service";
import { Background } from "../background";
import { getAppUrl } from "../email/client";
import { acceptInvitation } from "../invitation/accept";
import { acceptInvitationPath } from "../invitation/accept-path";
import { createInvitation } from "../invitation/create";
import { revokeInvitation } from "../invitation/revoke";
import { requireInvitationAccept, requireInvite, requireMembership } from "../membership/guard";
import { parseZodBody, parseZodBodyWithDetails, roleBodySchema } from "./parse-body";
import { captureCause } from "../sentry";
import { redirectTargetSchema } from "../sign-in-params";
import { runRoute } from "./run-route";

export const accountInvitation = new Hono();

const createInvitationBody = z
  .object({
    email: z.email().max(320),
    role: roleBodySchema,
    redirect_target: redirectTargetSchema.optional(),
  })
  .transform((d) => ({ ...d, email: d.email.toLowerCase() }));

const acceptInvitationBody = z
  .object({ invitation_token: z.string().min(1).max(256) })
  .transform((d) => ({ token: d.invitation_token }));

accountInvitation.post("/api/account/companies/:companyId/invitations", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const { actor, email, role, redirect_target } = yield* requireInvite({
        headers: c.req.raw.headers,
        companyId,
        parseBody: parseZodBodyWithDetails(c, createInvitationBody),
      });
      const result = yield* createInvitation({ actorUserId: actor.id, companyId, email, role });
      const invitationRow = result.invitation;

      const callbackURL = `${getAppUrl()}${acceptInvitationPath(invitationRow.token, redirect_target)}`;
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

// invitation.email === session.email の厳密一致で、盗んだ token の使用を防ぐ。
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
