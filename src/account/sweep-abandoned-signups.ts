import { findAbandonedSignupUserIds } from "@/db/repositories/user";
import { runInTransaction } from "@/db/transaction";
import { deleteAccountIfOrphaned } from "./orphan";

export type SweepReport = {
  executed: boolean;
  candidateCount: number;
  deletedUserIds: string[];
};

// ADR-0010 D5: 登録途中放棄アカウントの TTL sweep。olderThanMs より古く所属 0 件のアカウントを削除する。
// D2 で通常の orphan は即削除されるため、唯一許容する 0 件状態 (signup 登録途中) を恒久化させないための
// 安全網。候補抽出と削除の間に user が事業所を作る race は、削除を tx 内 deleteAccountIfOrphaned に通して
// 「ACTIVE 所属 0 件」を再判定することで防ぐ。設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
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
