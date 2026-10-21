import { Clock, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { AuthApi } from "../auth-service";
import { Background } from "../background";
import { getAppUrl } from "../email/client";
import { acceptInvitation } from "../invitation/accept";
import { acceptInvitationPath } from "../invitation/accept-path";
import { createInvitation } from "../invitation/create";
import { InvitationRepo } from "../invitation/ports";
import { revokeInvitation } from "../invitation/revoke";
import { requireInvitationAccept, requireInvite, requireMembershipOf } from "../membership/guard";
import { captureCause } from "../sentry";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

export const InvitationHandlers = HttpApiBuilder.group(SpaApi, "invitation", (handlers) =>
  handlers.handleAll({
    pending: Effect.fnUntraced(function* ({ params }) {
      yield* requireMembershipOf(yield* CurrentActor, params.companyId, "ADMIN");
      const now = new Date(yield* Clock.currentTimeMillis);
      const invitations = yield* InvitationRepo.use((repo) =>
        repo.listPendingInvitations(params.companyId, now),
      );
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
      const { actor, email, role, redirect_target } = yield* requireInvite({
        actor: yield* CurrentActor,
        companyId: params.companyId,
        body: payload,
      });
      const result = yield* createInvitation({
        actorUserId: actor.id,
        companyId: params.companyId,
        email,
        role,
      });
      const invitationRow = result.invitation;
      const callbackURL = `${getAppUrl()}${acceptInvitationPath(invitationRow.token, redirect_target)}`;
      const authApi = yield* AuthApi;
      const background = yield* Background;
      yield* background.run(
        authApi
          .signInMagicLink({ email, callbackURL })
          .pipe(Effect.catch(captureCause({ tags: { handler: "accountInvitation" } }))),
      );
      return {
        invitation: {
          id: invitationRow.id,
          email: invitationRow.email,
          role: invitationRow.role,
          expires_at: invitationRow.expiresAt.toISOString(),
        },
        reused: result.reused,
      };
    }, dieOnBoundary),
    revoke: Effect.fnUntraced(function* ({ params }) {
      const actor = yield* CurrentActor;
      yield* requireMembershipOf(actor, params.companyId, "ADMIN");
      yield* revokeInvitation({
        actorUserId: actor.id,
        companyId: params.companyId,
        invitationId: params.invitationId,
      });
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
      const result = yield* acceptInvitation({
        actor: grant.actor,
        invitation: grant.invitation,
      });
      return { ok: true as const, company_id: result.companyId };
    }, dieOnBoundary),
  }),
);
