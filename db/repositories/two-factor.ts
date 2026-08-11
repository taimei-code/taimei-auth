import { desc, eq } from "drizzle-orm";
import { db } from "../client";
import { twoFactor } from "../schema";
import type { DbOrTx } from "../transaction";

// two_factor 行への直接アクセス。通常の enroll / activate / disable は better-auth twoFactor
// プラグインが行を所有する — プラグインが担う経路を repository で再実装しないこと。

// secret / backup_codes を読み出さない型にしているのは、状態確認のためだけに第二要素の実体を
// アプリのメモリへ載せないため。呼び出し側が必要とするのは verified の真偽だけ。
export type TwoFactorVerificationState = { verified: boolean };

// 読み出しは「MFA 登録状態」(CONTEXT.md) の解釈経由に限る (単一入口の宣言は解釈側が持つ)。

export async function findTwoFactorVerificationState(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<TwoFactorVerificationState | undefined> {
  return (
    txOrDb
      .select({ verified: twoFactor.verified })
      .from(twoFactor)
      .where(eq(twoFactor.userId, userId))
      // user あたり 1 行が UNIQUE で保証されるため通常は 1 件だが、万一 2 行残っても verified を
      // 優先し (id で決定化)、プラグインが有効化した行と読み側がずれるのを防ぐ。
      .orderBy(desc(twoFactor.verified), twoFactor.id)
      .limit(1)
      .then((rows) => rows.at(0))
  );
}

// 運用救済 (src/mfa/force-disable.ts 経由の management/disable-user-mfa.ts) 専用の強制削除。
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
