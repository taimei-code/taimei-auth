import { Clock, Effect } from "effect";
import type { Role } from "@/db/repositories/invitation";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { IdGenerator } from "../id-generator";
import { Transaction } from "../transaction";
import { RateLimited } from "./errors";
import { InvitationRepo } from "./ports";
import { tryConsumeInvitationQuota } from "./rate-limit";

// ADR-0012 (Use-case 層): 招待作成手続 (idempotency + rate-limit + INSERT + audit)。rate-limit を tx 内へ
// 統合しないのは、並行重複招待時の Redis カウンタ消費パターンが変わり監視系が silent に drift するため。
// 真並行では rate 2 回消費 + PENDING 2 行 INSERT があり得る (現行仕様。冪等契約は逐次 semantic で担保)。

const INVITE_TTL_MS = 24 * 60 * 60 * 1000; // invitation は 24h 有効 (CONTEXT.md 'invitation')

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

  const existing = yield* invitations.findActivePending(companyId, email);
  if (existing) return { invitation: existing, reused: true };

  const withinLimit = yield* tryConsumeInvitationQuota(companyId);
  if (!withinLimit) return yield* new RateLimited();

  const nowMillis = yield* Clock.currentTimeMillis;
  const inserted = yield* tx.run(
    Effect.fn("invitation.create.apply")(function* (t: DbTx) {
      const row = yield* invitations.insert(
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
