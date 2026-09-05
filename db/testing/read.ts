import { and, asc, count, eq, gt, inArray, like } from "drizzle-orm";
import { db } from "../client";
import {
  auditLog,
  company,
  invitation,
  membership,
  mfaRecoveryCode,
  mfaTotp,
  session,
  user,
} from "../schema";

// test の観測 (事後状態の読み取り) の正本。被験体 (port / use-case / repository) から独立した oracle にするため
// drizzle で直接読む。repository の find* は再利用しない。

export type MfaTotpRow = typeof mfaTotp.$inferSelect;

const first = <T>(rows: T[]): T | undefined => rows.at(0);

export function readUser(id: string): Promise<typeof user.$inferSelect | undefined> {
  return db.select().from(user).where(eq(user.id, id)).then(first);
}

export function readCompany(id: string): Promise<typeof company.$inferSelect | undefined> {
  return db.select().from(company).where(eq(company.id, id)).then(first);
}

export function readMembership(
  userId: string,
  companyId: string,
): Promise<typeof membership.$inferSelect | undefined> {
  return db
    .select()
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
    .then(first);
}

export function readMemberships(userId: string): Promise<(typeof membership.$inferSelect)[]> {
  return db.select().from(membership).where(eq(membership.userId, userId));
}

export function readMembershipsOfCompany(
  companyId: string,
): Promise<(typeof membership.$inferSelect)[]> {
  return db.select().from(membership).where(eq(membership.companyId, companyId));
}

export function countMemberships(companyId: string): Promise<number> {
  return db
    .select({ n: count() })
    .from(membership)
    .where(eq(membership.companyId, companyId))
    .then((rows) => rows[0]?.n ?? 0);
}

export function readSessions(userId: string): Promise<(typeof session.$inferSelect)[]> {
  return db.select().from(session).where(eq(session.userId, userId));
}

export function readInvitation(id: string): Promise<typeof invitation.$inferSelect | undefined> {
  return db.select().from(invitation).where(eq(invitation.id, id)).then(first);
}

export function readInvitationByToken(
  token: string,
): Promise<typeof invitation.$inferSelect | undefined> {
  return db.select().from(invitation).where(eq(invitation.token, token)).then(first);
}

export function readInvitationsByEmail(
  companyId: string,
  email: string,
): Promise<(typeof invitation.$inferSelect)[]> {
  return db
    .select()
    .from(invitation)
    .where(and(eq(invitation.companyId, companyId), eq(invitation.email, email)));
}

// PENDING かつ expires_at > now (strict)。now は等号の境界を test するため注入できる。
export function readPendingInvitation(
  companyId: string,
  email: string,
  now: Date = new Date(),
): Promise<typeof invitation.$inferSelect | undefined> {
  return db
    .select()
    .from(invitation)
    .where(
      and(
        eq(invitation.companyId, companyId),
        eq(invitation.email, email),
        eq(invitation.status, "PENDING"),
        gt(invitation.expiresAt, now),
      ),
    )
    .then(first);
}

export function readAuditRows(
  userId: string,
  eventType: string,
): Promise<(typeof auditLog.$inferSelect)[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.userId, userId), eq(auditLog.eventType, eventType)))
    .orderBy(asc(auditLog.createdAt));
}

export function readMfaTotp(userId: string): Promise<MfaTotpRow | undefined> {
  return db.select().from(mfaTotp).where(eq(mfaTotp.userId, userId)).then(first);
}

export function readRecoveryCodes(
  userId: string,
): Promise<(typeof mfaRecoveryCode.$inferSelect)[]> {
  return db.select().from(mfaRecoveryCode).where(eq(mfaRecoveryCode.userId, userId));
}

export function readUserIdsByEmails(emails: string[]): Promise<string[]> {
  if (emails.length === 0) return Promise.resolve([]);
  return db
    .select({ id: user.id })
    .from(user)
    .where(inArray(user.email, emails))
    .then((rows) => rows.map((r) => r.id));
}

export function readCompanyIdsByName(name: string): Promise<string[]> {
  return db
    .select({ id: company.id })
    .from(company)
    .where(eq(company.name, name))
    .then((rows) => rows.map((r) => r.id));
}

export function readUserIdsByEmailPrefix(prefix: string): Promise<string[]> {
  return db
    .select({ id: user.id })
    .from(user)
    .where(like(user.email, `${prefix}%`))
    .then((rows) => rows.map((r) => r.id));
}
