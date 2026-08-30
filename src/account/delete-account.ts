import { recordAccountDeleted } from "@/db/repositories/audit-log";
import { deleteUser, type UserRow } from "@/db/repositories/user";
import type { DbTx } from "@/db/transaction";
import { revokeUserSessions } from "./revoke-sessions";

// アカウント削除 3 手順 (audit → session 失効 → 物理削除) の唯一の実装。orphan 連動削除と退会 RPC の
// 両経路がここを通り、順序変更が片経路だけに入るのを防ぐ。順序根拠:
// - audit を先に置くのは tx 失敗時に audit だけ残さないため (audit_log.user_id は FK なしで cascade しない)
// - session 失効の Redis 側は rollback に追随しないが「user 残存 + 全 session ログアウト」で fail-closed
// - cookieCache (最大 5 分) の窓内の削除済み user は membership guard の存在チェックが 401 に倒す
export async function deleteAccount(userId: string, tx: DbTx): Promise<UserRow | undefined> {
  await recordAccountDeleted({ user_id: userId }, tx);
  await revokeUserSessions(userId, tx);
  return deleteUser(userId, tx);
}
