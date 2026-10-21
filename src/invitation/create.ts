import { Clock, Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx } from "../audit/append";
import { AuthApi } from "../auth-service";
import { Background } from "../background";
import { getAppUrl } from "../email/client";
import { IdGenerator } from "../id-generator";
import type { InviteGrant } from "../membership/guard";
import { captureCause } from "../sentry";
import { Transaction } from "../transaction";
import { acceptInvitationPath } from "./accept-path";
import { InvitationRepo } from "./ports";
import { spendInvitationAttempt } from "./attempt-budget";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const sendInvitationLink = Effect.fnUntraced(function* (grant: InviteGrant, token: string) {
  const authApi = yield* AuthApi;
  const background = yield* Background;
  const callbackURL = `${getAppUrl()}${acceptInvitationPath(token, grant.redirectTarget)}`;
  yield* background.run(
    authApi
      .signInMagicLink({ email: grant.email, callbackURL })
      .pipe(Effect.catch(captureCause({ tags: { handler: "accountInvitation" } }))),
  );
});

const findOrInsertInvitation = Effect.fnUntraced(function* (grant: InviteGrant) {
  const { companyId, email, role } = grant;
  const actorUserId = grant.actor.id;
  const invitations = yield* InvitationRepo;
  const ids = yield* IdGenerator;
  const tx = yield* Transaction;

  const nowMillis = yield* Clock.currentTimeMillis;
  const existing = yield* invitations.findActivePendingInvitation(
    companyId,
    email,
    new Date(nowMillis),
  );
  if (existing) return { invitation: existing, reused: true };

  yield* spendInvitationAttempt(companyId);

  const inserted = yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      const row = yield* invitations.insertInvitation(
        {
          id: ids.invitationId(),
          companyId,
          email,
          role,
          token: ids.invitationToken(),
          expiresAt: new Date(nowMillis + INVITE_TTL_MS),
          invitedByUserId: actorUserId,
        },
        t,
      );
      yield* appendAuditInTx(t, {
        eventType: "invitation_sent",
        userId: actorUserId,
        payload: {
          invitation_id: row.id,
          company_id: companyId,
          invited_email: email,
          role,
          invited_by_user_id: actorUserId,
        },
      });
      return row;
    }),
  );

  return { invitation: inserted, reused: false };
});

export const createInvitation = Effect.fnUntraced(function* (grant: InviteGrant) {
  const result = yield* findOrInsertInvitation(grant);
  yield* sendInvitationLink(grant, result.invitation.token);
  return result;
});
