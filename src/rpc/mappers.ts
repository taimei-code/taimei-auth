import type { MemberRow, Role } from "@/db/repositories/membership";
import type { UserRow } from "@/db/repositories/user";
import type { Session } from "../auth";
import { Role as ProtoRole } from "../gen/auth/v1/auth_pb";

export const toProtoRole = (role: Role): ProtoRole => ProtoRole[role];

export function toProtoCompanyMember(row: MemberRow) {
  return {
    userId: row.userId,
    name: row.userName,
    email: row.userEmail,
    role: toProtoRole(row.role),
  };
}

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

type SessionRowLike = Pick<Session["session"], "id" | "expiresAt">;

export function toProtoSession(sessionRow: SessionRowLike) {
  return {
    id: sessionRow.id,
    expiresAt: sessionRow.expiresAt.toISOString(),
    sessionKind: "user",
  };
}
