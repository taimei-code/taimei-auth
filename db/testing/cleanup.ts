import { eq, inArray } from "drizzle-orm";
import { db } from "../client";
import { auditLog, company, invitation, user } from "../schema";

// prefix に依らない cleanup (e2e fixture の email / 固定 id / company 名ベースの回収)。

export async function deleteUsersByIds(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.delete(user).where(inArray(user.id, userIds));
}

export async function deleteAuditByUserIds(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db.delete(auditLog).where(inArray(auditLog.userId, userIds));
}

export async function deleteCompaniesByNames(names: string[]): Promise<void> {
  if (names.length === 0) return;
  await db.delete(company).where(inArray(company.name, names));
}

export async function deleteInvitationByToken(token: string): Promise<void> {
  await db.delete(invitation).where(eq(invitation.token, token));
}
