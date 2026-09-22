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
    defaultCompanyId: userRow.lastUsedCompanyId ?? undefined,
  };
}

export function userResponse(row: UserRow | undefined) {
  return { user: row ? toProtoUser(row) : undefined };
}

type SessionRowLike = Pick<Session["session"], "id" | "expiresAt">;

export function toProtoSession(sessionRow: SessionRowLike) {
  return {
    id: sessionRow.id,
    expiresAt: sessionRow.expiresAt.toISOString(),
    sessionKind: "user",
  };
}

// password や idToken を漏らさないよう、明示的な許可リストで mapping する。
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
