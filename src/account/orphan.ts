import { countActiveMembershipsByUserId } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { deleteAccount } from "./delete-account";

// ADR-0010 D2: 「所属 0 件アカウント (orphan) は存在不可」を 1 箇所に集約する共有プリミティブ。membership が
// 減る全経路が直後にこれを通し判定の書き忘れを防ぐ。削除手順と順序根拠は delete-account.ts に集約。
export async function deleteAccountIfOrphaned(userId: string, tx: DbTx): Promise<boolean> {
  if ((await countActiveMembershipsByUserId(userId, tx)) > 0) return false;
  await deleteAccount(userId, tx);
  return true;
}
