import { Clock, Effect } from "effect";
import { Transaction } from "../transaction";
import { deleteSessionsOf } from "./delete-sessions";
import { deleteAccountIfOrphaned } from "./orphan";
import { UserRepo } from "./ports";

type SweepReport = {
  executed: boolean;
  candidateCount: number;
  deletedUserIds: string[];
};

export const sweepAbandonedSignups = Effect.fnUntraced(function* (opts: {
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
    tx
      .run((t) => deleteAccountIfOrphaned(userId, t))
      .pipe(Effect.tap((deleted) => (deleted ? deleteSessionsOf([userId], "sweep") : Effect.void))),
  );
  return {
    executed: true,
    candidateCount: candidates.length,
    deletedUserIds,
  } satisfies SweepReport;
});
