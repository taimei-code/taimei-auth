import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { company, membership } from "../schema";
import type { DbOrTx, DbTx } from "../transaction";

// ADR-009: Stripe 流 prefix `mbr_<24chars>` で entity type を log / audit_log 上で即判定可能に。
export const generateMembershipId = (): string => `mbr_${nanoid(24)}`;

export type MembershipRow = typeof membership.$inferSelect;
export type Role = "OWNER" | "ADMIN" | "MEMBER";

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

// ADR-009: OWNER ≥ 1 invariant をアプリ層で守る。
// outer transaction を必須にして「OWNER 行 lock → 操作 → 再 count 検証」を atomic に。
// 全 mutation 経路 (DeleteMembership / UpdateRole / TransferOwnership / DeleteUser) は必ずこれを経由する。
export async function withOwnerLockGuard<T>(
  tx: DbTx,
  companyId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  await tx.execute(
    sql`SELECT id FROM membership WHERE company_id = ${companyId} AND role = 'OWNER' FOR UPDATE`,
  );
  const result = await fn(tx);
  const remaining = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(membership)
    .where(and(eq(membership.companyId, companyId), eq(membership.role, "OWNER")));
  const remainingCount = remaining.at(0)?.count ?? 0;
  if (remainingCount < 1) {
    throw new OwnerInvariantViolation(companyId);
  }
  return result;
}

export class OwnerInvariantViolation extends Error {
  constructor(public readonly companyId: string) {
    super(`OWNER count must be >= 1 for company ${companyId}`);
    this.name = "OwnerInvariantViolation";
  }
}
