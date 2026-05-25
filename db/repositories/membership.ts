import { and, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { company, membership, user } from "../schema";
import type { DbOrTx, DbTx } from "../transaction";

// ADR-009: Stripe 流 prefix `mbr_<24chars>` で entity type を log / audit_log 上で即判定可能に。
export const generateMembershipId = (): string => `mbr_${nanoid(24)}`;

// ADR-009: signup の CreateCompany で同 user の 2 tab 同時 submit を直列化する per-user 排他ロック。
// user_id 単独の unique 制約は N:M (1 user が複数 company 所属) と衝突するため使えず、
// transaction-scoped advisory lock + tx 内 re-check で TOCTOU を解消する。
// hashtext(text) は int4 を返し pg_advisory_xact_lock(bigint) に暗黙 cast される。
export async function lockUserForCompanyCreation(tx: DbTx, userId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
}

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

export type MemberRow = {
  membershipId: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: string;
  joinedAt: Date;
};

// 事業所のメンバー一覧 (membership × user join)。Members 画面の表示用。
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
