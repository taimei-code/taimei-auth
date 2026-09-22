import { Clock, Effect } from "effect";
import { Transaction } from "../transaction";
import { deleteAccountIfOrphaned } from "./orphan";
import { UserRepo } from "./ports";

type SweepReport = {
  executed: boolean;
  candidateCount: number;
  deletedUserIds: string[];
};

// 候補の抽出から削除までの間に事業所が作成される race は、tx 内の deleteAccountIfOrphaned が再判定して防ぐ。
export const sweepAbandonedSignups = Effect.fn("account.sweepAbandonedSignups")(function* (opts: {
  olderThanMs: number;
  execute: boolean;
}) {
  const now = yield* Clock.currentTimeMillis;
  const threshold = new Date(now - opts.olderThanMs);
  const candidates = yield* UserRepo.use((users) => users.findAbandonedSignupUserIds(threshold));
  if (!opts.execute) {
    return {
      executed: false,
      candidateCount: candidates.length,
      deletedUserIds: candidates,
    } satisfies SweepReport;
  }

  const tx = yield* Transaction;
  const deletedUserIds = yield* Effect.filter(candidates, (userId) =>
    tx.run((t) => deleteAccountIfOrphaned(userId, t)),
  );
  return {
    executed: true,
    candidateCount: candidates.length,
    deletedUserIds,
  } satisfies SweepReport;
});
