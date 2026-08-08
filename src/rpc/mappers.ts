import type { AccountRow } from "@/db/repositories/account";
import type { UserRow } from "@/db/repositories/user";
import type { Session } from "../auth";

export function toProtoUser(userRow: UserRow) {
  return {
    id: userRow.id,
    name: userRow.name,
    email: userRow.email,
    emailVerified: userRow.emailVerified,
    image: userRow.image ?? undefined,
    createdAt: userRow.createdAt.toISOString(),
    updatedAt: userRow.updatedAt.toISOString(),
    revision: userRow.revision,
    // proto field 名は default_company_id (ADR-009)、DB 列は last_used_company_id。
    defaultCompanyId: userRow.lastUsedCompanyId ?? undefined,
  };
}

// session_kind は現状 "user" 固定。将来 enum 化を予定。
// db/CLAUDE.md ルール 2 例外: session repository を作らない方針 (better-auth secondaryStorage の
// stale 問題回避) のため、SessionRow 型を import せず better-auth Session 型から派生する。
// better-auth の Session.session 型変更を compile-time に検出するため Pick で型固定。
// proto Session.company_id はここでは埋めない — 現在事業所は User.default_company_id 経由で公開する。
type SessionRowLike = Pick<Session["session"], "id" | "expiresAt">;

export function toProtoSession(sessionRow: SessionRowLike) {
  return {
    id: sessionRow.id,
    expiresAt: sessionRow.expiresAt.toISOString(),
    sessionKind: "user",
  };
}

// password / idToken / accessTokenExpiresAt 等は proto に乗せない (consumer は不要)。
// 漏出するとセキュリティリスク (password hash leak) で、かつ SDK で trim 済の dead field に
// 該当するため、明示的に whitelist mapping する。
export function toProtoAccount(accountRow: AccountRow) {
  return {
    id: accountRow.id,
    accountId: accountRow.accountId,
    providerId: accountRow.providerId,
    userId: accountRow.userId,
    accessToken: accountRow.accessToken ?? undefined,
    refreshToken: accountRow.refreshToken ?? undefined,
    scope: accountRow.scope ?? undefined,
  };
}
