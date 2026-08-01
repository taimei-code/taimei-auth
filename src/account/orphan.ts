import { countActiveMembershipsByUserId } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { deleteAccount } from "./delete-account";

// ADR-0010 D2: 「所属 0 件アカウント (orphan) は存在不可」という不変条件を 1 箇所に集約する共有プリミティブ。
// membership が減る全経路 (DeleteCompany / 退会 / 除名 / TTL sweep) がこの 1 関数を直後に通すことで、
// 呼び出し側ごとに orphan 判定を書き忘れて不変条件が破れるのを防ぐ。
// 設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
// 削除手順そのもの (audit → session 失効 → 物理削除) と順序根拠は delete-account.ts に集約。
export async function deleteAccountIfOrphaned(userId: string, tx: DbTx): Promise<boolean> {
  if ((await countActiveMembershipsByUserId(userId, tx)) > 0) return false;
  await deleteAccount(userId, tx);
  return true;
}
