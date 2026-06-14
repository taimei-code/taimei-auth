import { appendAuditLog } from "@/db/repositories/audit-log";
import { countActiveMembershipsByUserId } from "@/db/repositories/membership";
import { revokeAllSessionsForUser } from "@/db/repositories/session";
import { deleteUser } from "@/db/repositories/user";
import type { DbTx } from "@/db/transaction";

// ADR-0010 D2: 「所属 0 件アカウント (orphan) は存在不可」という不変条件を 1 箇所に集約する共有プリミティブ。
// membership が減る全経路 (DeleteCompany / 退会 / 除名 / TTL sweep) がこの 1 関数を直後に通すことで、
// 呼び出し側ごとに orphan 判定を書き忘れて不変条件が破れるのを防ぐ。
// 設計詳細: docs/adr/0010-company-account-deletion-lifecycle.md
//
// 削除は退会 (src/rpc/user-handler.ts deleteUser) と同じく audit → session 失効 → 物理削除の順。
// session 失効は better-auth cookieCache (最大 5 分) を即時無効化しない既知制約を退会と同様に受容する
// (db/CLAUDE.md ルール 2 例外)。tx 失敗時は audit も含め全 rollback される (同一 tx)。
export async function deleteAccountIfOrphaned(userId: string, tx: DbTx): Promise<boolean> {
  if ((await countActiveMembershipsByUserId(userId, tx)) > 0) return false;
  await appendAuditLog({ eventType: "account_delete", userId, payload: {} }, tx);
  await revokeAllSessionsForUser(userId, tx);
  await deleteUser(userId, tx);
  return true;
}
