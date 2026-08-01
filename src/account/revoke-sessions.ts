import { auth } from "../auth";
// biome-ignore lint/style/noRestrictedImports: revokeUserSessions が唯一の正規窓口 (下記コメント参照)
import { revokeAllSessionsForUser } from "@/db/repositories/session";
import type { DbTx } from "@/db/transaction";

// アカウント削除経路 (orphan 連動削除 / 退会 RPC) の session 失効の唯一の窓口。
// better-auth は secondaryStorage 構成時、session 実体を Redis のみに保存する
// (Postgres session テーブルは常に空)。DB 側の revoked_at 記帳だけでは失効せず、
// 削除済み user の session cookie が認証を通り続け、membership insert の FK 違反 500 に至った
// 実障害があるため、internalAdapter.deleteUserSessions で Redis の実体 + 索引を必ず消す。
// DB 記帳は storeSessionInDatabase 有効化時の forensic 層 (revoked_at 時刻保全) として併走させる。
//
// Redis 削除は呼び出し元 tx の rollback に追随しない。tx が後段で失敗した場合は
// 「user 残存 + 全 session ログアウト」に倒れる = fail-closed (逆順だと commit 直後の crash で
// 「user 消滅 + session 生存」の穴が開く) ため、この順序を崩さないこと。
export async function revokeUserSessions(userId: string, tx: DbTx): Promise<void> {
  await revokeAllSessionsForUser(userId, tx);
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
}
