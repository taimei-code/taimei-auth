import { recordAccountDeleted } from "@/db/repositories/audit-log";
import { deleteUser, type UserRow } from "@/db/repositories/user";
import type { DbTx } from "@/db/transaction";
import { revokeUserSessions } from "./revoke-sessions";

// アカウント削除 3 手順 (audit → session 失効 → 物理削除) の唯一の実装。orphan 連動削除
// (src/account/orphan.ts) と退会 RPC (src/rpc/user-handler.ts) の両経路がここを通ることで、
// 手順や順序の変更が片経路だけに入って silent に食い違うのを防ぐ。
//
// 順序根拠:
// - audit を delete 前に置くのは tx 失敗時に audit だけ残さないため (account_delete audit は
//   compliance 必須のため失敗時 rethrow)。audit_log.user_id は FK なしのため (db/schema.ts)
//   user cascade delete 後も audit_log は残る
// - session 失効の Redis 側は tx rollback に追随しないが「user 残存 + 全 session ログアウト」=
//   fail-closed に倒れる (詳細: src/account/revoke-sessions.ts)
// - better-auth cookieCache (最大 5 分) は即時無効化されない既知制約。窓内の削除済み user は
//   membership guard の user 存在チェック (src/membership/guard/core.ts) が 401 に倒す
export async function deleteAccount(userId: string, tx: DbTx): Promise<UserRow | undefined> {
  await recordAccountDeleted({ user_id: userId }, tx);
  await revokeUserSessions(userId, tx);
  return deleteUser(userId, tx);
}
