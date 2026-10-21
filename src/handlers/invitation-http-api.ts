import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { acceptInvitation } from "../invitation/accept";
import { createInvitation } from "../invitation/create";
import { pendingInvitationsOf } from "../invitation/pending-invitations";
import { revokeInvitation } from "../invitation/revoke";
import { requireInvitationAccept, requireInvite, requireMembershipOf } from "../membership/guard";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

export const InvitationHandlers = HttpApiBuilder.group(SpaApi, "invitation", (handlers) =>
  handlers.handleAll({
    pending: Effect.fnUntraced(function* ({ params }) {
      const member = yield* requireMembershipOf(yield* CurrentActor, params.companyId, "ADMIN");
      const invitations = yield* pendingInvitationsOf(member);
      return {
        invitations: invitations.map((inv) => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          expires_at: inv.expiresAt.toISOString(),
          created_at: inv.createdAt.toISOString(),
        })),
      };
    }, dieOnBoundary),
    create: Effect.fnUntraced(function* ({ params, payload }) {
      const grant = yield* requireInvite({
        actor: yield* CurrentActor,
        companyId: params.companyId,
        body: payload,
      });
      const { invitation, reused } = yield* createInvitation(grant);
      return {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          expires_at: invitation.expiresAt.toISOString(),
        },
        reused,
      };
    }, dieOnBoundary),
    revoke: Effect.fnUntraced(function* ({ params }) {
      const member = yield* requireMembershipOf(yield* CurrentActor, params.companyId, "ADMIN");
      yield* revokeInvitation(member, params.invitationId);
      return { ok: true as const };
    }, dieOnBoundary),
    accept: Effect.fnUntraced(function* ({ payload }) {
      const grant = yield* requireInvitationAccept({
        actor: yield* CurrentActor,
        token: payload.invitation_token,
      });
      if (grant.mode === "reused") {
        return { ok: true as const, company_id: grant.companyId, reused: true as const };
      }
      const result = yield* acceptInvitation(grant);
      return { ok: true as const, company_id: result.companyId };
    }, dieOnBoundary),
  }),
);
