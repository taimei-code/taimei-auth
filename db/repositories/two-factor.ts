import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { twoFactor } from "../schema";
import type { DbOrTx } from "../transaction";

// two_factor 行への直接アクセス。通常の enroll / activate / disable はプラグインが行を所有する —
// プラグインが担う経路を repository で再実装しないこと。

// secret / backup_codes を読み出さない型にしているのは、第二要素の実体をアプリのメモリへ載せないため。
export type TwoFactorVerificationState = { id: string; verified: boolean };

// 読んだ行の解釈 (評決の組み立て) は「MFA 登録状態」を所有する側に集約する — 呼び出し側で verified を
// 直接分岐させない。入口の集合は containment tripwire (QA-I-01) が機械的に固定する。

export async function findTwoFactorVerificationState(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<TwoFactorVerificationState | undefined> {
  return (
    txOrDb
      .select({ id: twoFactor.id, verified: twoFactor.verified })
      .from(twoFactor)
      .where(eq(twoFactor.userId, userId))
      // user あたり 1 行が UNIQUE だが、万一 2 行残っても verified 優先 (id で決定化) にして
      // プラグインが有効化した行と読み側がずれるのを防ぐ。
      .orderBy(desc(twoFactor.verified), twoFactor.id)
      .limit(1)
      .then((rows) => rows.at(0))
  );
}

// MFA 運用救済 (management/disable-user-mfa.ts) 専用の強制削除。
export async function deleteTwoFactorByUserId(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<number> {
  return txOrDb
    .delete(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .returning({ id: twoFactor.id })
    .then((rows) => rows.length);
}
