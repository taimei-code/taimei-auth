import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { company, membership, type Role, user } from "../schema";
import type { DbOrTx, DbTx } from "../transaction";

export const generateMembershipId = (): string => `mbr_${nanoid(24)}`;

// user_id 単独の unique 制約は N:M と衝突するため advisory lock + tx 内 re-check で TOCTOU を防ぐ。
export async function lockUserForCompanyCreation(tx: DbTx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
}

// 事業所削除と membership の減る変更を同じ OWNER 行で contend させる。WHERE が片方だけ変わると直列化が silent に外れる。
export async function lockOwnerMembershipsOfCompany(tx: DbTx, companyId: string): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM membership WHERE company_id = ${companyId} AND role = 'OWNER' FOR UPDATE`,
  );
}

export type MembershipRow = typeof membership.$inferSelect;
export type { Role };

export type MembershipWithCompany = MembershipRow & {
  companyName: string;
  companyOrgCode: string;
  companyActivationStatus: string;
};

export async function findMembershipsByUserId(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<MembershipWithCompany[]> {
  return txOrDb
    .select({
      id: membership.id,
      userId: membership.userId,
      companyId: membership.companyId,
      role: membership.role,
      joinedAt: membership.joinedAt,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
      companyName: company.name,
      companyOrgCode: company.orgCode,
      companyActivationStatus: company.activationStatus,
    })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(eq(membership.userId, userId));
}

export async function countActiveMembershipsByUserId(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<number> {
  const rows = await txOrDb
    .select({ count: sql<number>`count(*)::int` })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(and(eq(membership.userId, userId), eq(company.activationStatus, "ACTIVE")));
  return rows.at(0)?.count ?? 0;
}

export async function removeMembershipsOfCompany(
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<MembershipRow[]> {
  return txOrDb.delete(membership).where(eq(membership.companyId, companyId)).returning();
}

export async function findDeletedCompanyIdsWithMemberships(txOrDb: DbOrTx = db): Promise<string[]> {
  const rows = await txOrDb
    .selectDistinct({ companyId: membership.companyId })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .where(eq(company.activationStatus, "DELETED"));
  return rows.map((r) => r.companyId);
}

export type MemberRow = {
  membershipId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: Role;
  joinedAt: Date;
};

export async function findMembersByCompanyId(
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<MemberRow[]> {
  return txOrDb
    .select({
      membershipId: membership.id,
      userId: membership.userId,
      userName: user.name,
      userEmail: user.email,
      role: membership.role,
      joinedAt: membership.joinedAt,
    })
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .where(eq(membership.companyId, companyId));
}

export async function findMembership(
  userId: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<MembershipRow | undefined> {
  return txOrDb
    .select()
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
    .limit(1)
    .then((rows) => rows.at(0));
}

// tx を必須にするのは autocommit だと FOR SHARE lock が statement 終了で解放され TOCTOU が復活するため。
export async function lockMembershipForShare(
  tx: DbTx,
  userId: string,
  companyId: string,
): Promise<{ role: Role } | undefined> {
  return tx
    .select({ role: membership.role })
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
    .limit(1)
    .for("share")
    .then((rows) => rows.at(0));
}

export async function insertMembership(
  params: { id: string; userId: string; companyId: string; role: Role },
  txOrDb: DbOrTx = db,
): Promise<MembershipRow> {
  return txOrDb
    .insert(membership)
    .values({
      id: params.id,
      userId: params.userId,
      companyId: params.companyId,
      role: params.role,
    })
    .returning()
    .then((rows) => {
      const row = rows.at(0);
      if (!row) {
        throw new Error("membership INSERT returned no row");
      }
      return row;
    });
}

export async function updateMembershipRole(
  userId: string,
  companyId: string,
  role: Role,
  txOrDb: DbOrTx = db,
): Promise<MembershipRow | undefined> {
  return txOrDb
    .update(membership)
    .set({ role })
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
    .returning()
    .then((rows) => rows.at(0));
}

export async function deleteMembership(
  userId: string,
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<MembershipRow | undefined> {
  return txOrDb
    .delete(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
    .returning()
    .then((rows) => rows.at(0));
}

export async function countOwnerMemberships(tx: DbTx, companyId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.role, "OWNER")));
  return rows.at(0)?.count ?? 0;
}

export type BlockingCompany = { companyId: string; companyName: string };

export async function findCompaniesBlockingUserDeletion(
  userId: string,
  txOrDb: DbOrTx = db,
): Promise<BlockingCompany[]> {
  const ownerCountByCompany = txOrDb
    .select({
      companyId: membership.companyId,
      ownerCount: sql<number>`count(*)::int`.as("owner_count"),
    })
    .from(membership)
    .where(eq(membership.role, "OWNER"))
    .groupBy(membership.companyId)
    .as("owner_counts");

  return txOrDb
    .select({ companyId: company.id, companyName: company.name })
    .from(membership)
    .innerJoin(company, eq(company.id, membership.companyId))
    .innerJoin(ownerCountByCompany, eq(ownerCountByCompany.companyId, membership.companyId))
    .where(
      and(
        eq(membership.userId, userId),
        eq(membership.role, "OWNER"),
        eq(company.activationStatus, "ACTIVE"),
        eq(ownerCountByCompany.ownerCount, 1),
      ),
    );
}
