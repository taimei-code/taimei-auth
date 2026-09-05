import { Clock, Effect } from "effect";
import { Transaction } from "../transaction";
import { deleteAccountIfOrphaned } from "./orphan";
import { UserRepo } from "./ports";

type SweepReport = {
  executed: boolean;
  candidateCount: number;
  deletedUserIds: string[];
};

// ADR-0010 D5: 登録途中放棄アカウントの TTL sweep。候補抽出と削除の間に user が事業所を作る race は、
// 削除を tx 内 deleteAccountIfOrphaned に通して「ACTIVE 所属 0 件」を再判定することで防ぐ。
export const sweepAbandonedSignups = Effect.fn("account.sweepAbandonedSignups")(function* (opts: {
  olderThanMs: number;
  execute: boolean;
}) {
  const users = yield* UserRepo;
  const now = yield* Clock.currentTimeMillis;
  const threshold = new Date(now - opts.olderThanMs);
  const candidates = yield* users.findAbandonedSignupUserIds(threshold);
  if (!opts.execute) {
    return {
      executed: false,
      candidateCount: candidates.length,
      deletedUserIds: candidates,
    } satisfies SweepReport;
  }

  const tx = yield* Transaction;
  const deletedUserIds: string[] = [];
  for (const userId of candidates) {
    const deleted = yield* tx.run((t) => deleteAccountIfOrphaned(userId, t));
    if (deleted) deletedUserIds.push(userId);
  }
  return {
    executed: true,
    candidateCount: candidates.length,
    deletedUserIds,
  } satisfies SweepReport;
});
