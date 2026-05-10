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
