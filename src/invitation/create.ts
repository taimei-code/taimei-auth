import { Clock, Effect } from "effect";
import type { Role } from "@/db/repositories/invitation";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { IdGenerator } from "../id-generator";
import { Transaction } from "../transaction";
import { InvitationRepo } from "./ports";
import { consumeInvitationQuota } from "./rate-limit";

// rate-limit を tx 内に入れると並行した重複招待でカウンタ消費が変わり、監視系との対応がずれる。

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export const createInvitation = Effect.fn("invitation.create")(function* (params: {
  actorUserId: string;
  companyId: string;
  email: string;
  role: Role;
}) {
  const { actorUserId, companyId, email, role } = params;
  const invitations = yield* InvitationRepo;
  const audit = yield* AuditLog;
  const ids = yield* IdGenerator;
  const tx = yield* Transaction;

  const existing = yield* invitations.findActivePendingInvitation(companyId, email);
  if (existing) return { invitation: existing, reused: true };

  yield* consumeInvitationQuota(companyId);

  const nowMillis = yield* Clock.currentTimeMillis;
  const inserted = yield* tx.run(
    Effect.fn("invitation.create.apply")(function* (t: DbTx) {
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
      yield* audit.recordInvitationSent(
        {
          actor_user_id: actorUserId,
          invitation_id: row.id,
          company_id: companyId,
          invited_email: email,
          role,
        },
        t,
      );
      return row;
    }),
  );

  return { invitation: inserted, reused: false };
});
