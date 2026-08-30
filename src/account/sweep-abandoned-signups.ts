import { findAbandonedSignupUserIds } from "@/db/repositories/user";
import { runInTransaction } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "./orphan";

export type SweepReport = {
  executed: boolean;
  candidateCount: number;
  deletedUserIds: string[];
};

// ADR-0010 D5: 登録途中放棄アカウントの TTL sweep。候補抽出と削除の間に user が事業所を作る race は、
// 削除を tx 内 deleteAccountIfOrphaned に通して「ACTIVE 所属 0 件」を再判定することで防ぐ。
export async function sweepAbandonedSignups(opts: {
  olderThanMs: number;
  execute: boolean;
}): Promise<SweepReport> {
  const threshold = new Date(Date.now() - opts.olderThanMs);
  const candidates = await findAbandonedSignupUserIds(threshold);
  if (!opts.execute) {
    return { executed: false, candidateCount: candidates.length, deletedUserIds: candidates };
  }
  const deletedUserIds: string[] = [];
  for (const userId of candidates) {
    await runInTransaction(async (tx) => {
      if (await deleteAccountIfOrphaned(userId, tx)) deletedUserIds.push(userId);
    });
  }
  return { executed: true, candidateCount: candidates.length, deletedUserIds };
}
