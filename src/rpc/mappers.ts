import type { AccountRow } from "@/db/repositories/account";
import type { UserRow } from "@/db/repositories/user";

export function toProtoUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.image ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revision: row.revision,
  };
}

// ADR-001 R7: session_kind は現状 "user" 固定。将来 "admin" | "system" | "assumed" に拡張。
// db/CLAUDE.md ルール 2 例外: session repository を作らない方針 (better-auth secondaryStorage の
// stale 問題回避) のため、SessionRow 型を import せず better-auth Session の最小サブセットで受ける。
type SessionRowLike = { id: string; expiresAt: Date };

export function toProtoSession(row: SessionRowLike) {
  return {
    id: row.id,
    expiresAt: row.expiresAt.toISOString(),
    sessionKind: "user",
  };
}

export function toProtoAccount(row: AccountRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    providerId: row.providerId,
    userId: row.userId,
    accessToken: row.accessToken ?? undefined,
    refreshToken: row.refreshToken ?? undefined,
    scope: row.scope ?? undefined,
  };
}
