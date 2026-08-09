import { eq } from "drizzle-orm";
import { db } from "../client";
import { twoFactor } from "../schema";
import type { DbOrTx } from "../transaction";

// two_factor 行への直接アクセス。通常の enroll / activate / disable は better-auth twoFactor
// プラグインが行を所有するため、ここを使うのは (a) 不変条件の観測 (b) 運用救済スクリプトによる
// 強制削除 の 2 つだけ。プラグインが担う経路を repository で再実装しないこと。

// secret / backup_codes を読み出さない型にしているのは、状態確認のためだけに第二要素の実体を
// アプリのメモリへ載せないため。呼び出し側が必要とするのは verified の真偽だけ。
export type TwoFactorVerificationState = { verified: boolean };

export async function findTwoFactorVerificationState(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<TwoFactorVerificationState | undefined> {
  return txOrDb
    .select({ verified: twoFactor.verified })
    .from(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .limit(1)
    .then((rows) => rows.at(0));
}

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
