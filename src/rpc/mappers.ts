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
    // proto field 名は default_company_id、DB 列は last_used_company_id (詳細: CONTEXT.md)。
    defaultCompanyId: userRow.lastUsedCompanyId ?? undefined,
  };
}

// user を返す 3 method (findUserByEmail / findUserById / getUser) の応答は同形。
export function userResponse(row: UserRow | undefined) {
  return { user: row ? toProtoUser(row) : undefined };
}

// session_kind は現状 "user" 固定。session repository を作らない方針 (db/CLAUDE.md ルール 2 例外) のため
// better-auth Session 型から Pick で派生し型変更を compile-time に検出する。company_id は埋めない。
type SessionRowLike = Pick<Session["session"], "id" | "expiresAt">;

export function toProtoSession(sessionRow: SessionRowLike) {
  return {
    id: sessionRow.id,
    expiresAt: sessionRow.expiresAt.toISOString(),
    sessionKind: "user",
  };
}

// password / idToken 等は proto に乗せない (漏出は password hash leak) ため明示的に whitelist mapping する。
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
