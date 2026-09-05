import { and, eq, like, or } from "drizzle-orm";
import { db } from "../client";
import { generateCompanyId } from "../repositories/company";
import { generateInvitationId, generateInvitationToken } from "../repositories/invitation";
import { generateMembershipId } from "../repositories/membership";
import {
  auditLog,
  company,
  invitation,
  membership,
  type OrgCode,
  type Role,
  session,
  user,
} from "../schema";

// test の seed / cleanup の正本 (db/CLAUDE.md の例外 path。理由は ADR-0017 Decision の依存注入項)。
// 列は明示して書く: seed は「test が指定した状態を作る」のが役目で、production の不変条件の写しではない。

// seed / cleanup / e2e fixture が共有する識別子の導出。片方だけ変えると cleanup が 0 件になる。
export const ids = (prefix: string) => ({
  userId: (suffix: string): string => `${prefix}u-${suffix}`,
  email: (suffix: string): string => `${prefix}${suffix}@example.com`,
  companyName: (suffix: string): string => `${prefix}co-${suffix}`,
});

export type SeededUser = { id: string; email: string };
export type SeededInvitation = { id: string; token: string };

export type SeedUserOptions = {
  emailVerified?: boolean;
  lastUsedCompanyId?: string | null;
  name?: string;
  email?: string;
  createdAt?: Date;
};

export type SeedInvitationOptions = {
  companyId: string;
  email: string;
  role: Role;
  invitedByUserId: string;
  status?: "PENDING" | "ACCEPTED" | "REVOKED";
  expiresAt?: Date;
  token?: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function createSeed(prefix: string) {
  // cleanup は prefix を LIKE に埋めるため、wildcard を含む prefix は他 suite の行を消す。
  if (/[%_\\]/.test(prefix)) throw new Error(`seed prefix に LIKE wildcard を含めない: ${prefix}`);
  const id = ids(prefix);

  const seedUser = async (suffix: string, opts: SeedUserOptions = {}): Promise<SeededUser> => {
    const userId = id.userId(suffix);
    const email = opts.email ?? id.email(suffix);
    await db.insert(user).values({
      id: userId,
      name: opts.name ?? `User ${suffix}`,
      email,
      emailVerified: opts.emailVerified ?? true,
      lastUsedCompanyId: opts.lastUsedCompanyId ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    });
    return { id: userId, email };
  };

  const seedSession = async (userId: string, suffix = userId): Promise<string> => {
    const sessionId = `${prefix}s-${suffix}`;
    await db.insert(session).values({
      id: sessionId,
      token: `${prefix}tok-${suffix}`,
      userId,
      expiresAt: new Date(Date.now() + DAY_MS),
    });
    return sessionId;
  };

  const seedCompany = async (suffix: string, orgCode: OrgCode = "PERSONAL"): Promise<string> => {
    const companyId = generateCompanyId();
    await db.insert(company).values({
      id: companyId,
      name: id.companyName(suffix),
      orgCode,
      activationStatus: "ACTIVE",
    });
    return companyId;
  };

  const seedMembership = async (
    userId: string,
    companyId: string,
    role: Role = "MEMBER",
  ): Promise<string> => {
    const membershipId = generateMembershipId();
    await db.insert(membership).values({ id: membershipId, userId, companyId, role });
    return membershipId;
  };

  // ACCEPTED / REVOKED は production の markInvitation* と同じ列 (accepted_at / revoked_at + used_at) を書く。
  const seedInvitation = async (opts: SeedInvitationOptions): Promise<SeededInvitation> => {
    const invitationId = generateInvitationId();
    const token = opts.token ?? generateInvitationToken();
    const now = new Date();
    const status = opts.status ?? "PENDING";
    await db.insert(invitation).values({
      id: invitationId,
      companyId: opts.companyId,
      email: opts.email,
      role: opts.role,
      token,
      expiresAt: opts.expiresAt ?? new Date(now.getTime() + DAY_MS),
      status,
      invitedByUserId: opts.invitedByUserId,
      acceptedAt: status === "ACCEPTED" ? now : null,
      revokedAt: status === "REVOKED" ? now : null,
      usedAt: status === "PENDING" ? null : now,
    });
    return { id: invitationId, token };
  };

  const markCompanyDeleted = async (
    companyId: string,
    opts: { deletedAt?: boolean } = {},
  ): Promise<void> => {
    await db
      .update(company)
      .set({
        activationStatus: "DELETED",
        ...((opts.deletedAt ?? true) ? { deletedAt: new Date() } : {}),
      })
      .where(eq(company.id, companyId));
  };

  const setMembershipRole = async (
    userId: string,
    companyId: string,
    role: Role,
  ): Promise<void> => {
    await db
      .update(membership)
      .set({ role })
      .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)));
  };

  const setLastUsedCompany = async (userId: string, companyId: string): Promise<void> => {
    await db.update(user).set({ lastUsedCompanyId: companyId }).where(eq(user.id, userId));
  };

  const setUserCreatedAt = async (userId: string, createdAt: Date): Promise<void> => {
    await db.update(user).set({ createdAt }).where(eq(user.id, userId));
  };

  const removeMembership = async (userId: string, companyId: string): Promise<void> => {
    await db
      .delete(membership)
      .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)));
  };

  const cleanup = async (): Promise<void> => {
    await db.delete(auditLog).where(like(auditLog.userId, `${prefix}%`));
    await db
      .delete(invitation)
      .where(
        or(like(invitation.email, `${prefix}%`), like(invitation.invitedByUserId, `${prefix}%`)),
      );
    await db.delete(session).where(like(session.userId, `${prefix}%`));
    await db.delete(membership).where(like(membership.userId, `${prefix}%`));
    await db.delete(company).where(like(company.name, `${prefix}%`));
    await db.delete(user).where(like(user.id, `${prefix}%`));
  };

  return {
    seedUser,
    seedSession,
    seedCompany,
    seedMembership,
    seedInvitation,
    markCompanyDeleted,
    setMembershipRole,
    setLastUsedCompany,
    setUserCreatedAt,
    removeMembership,
    cleanup,
  };
}
