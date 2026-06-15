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

// ADR-0010 (BB-11): 事業所削除と member remove の異経路同時実行を直列化する。
// withOwnerLockGuard と同じ OWNER 行を FOR UPDATE で取り、両経路が同じ行で contend するようにする。
// DeleteCompany は全 membership を消すため OWNER≥1 の事後検証は不要 (= guard ではなく lock のみ)。
export async function lockOwnerMembershipsOfCompany(tx: DbTx, companyId: string): Promise<void> {
  await tx.execute(
    sql`SELECT id FROM membership WHERE company_id = ${companyId} AND role = 'OWNER' FOR UPDATE`,
  );
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

// ADR-0010 D2: orphan 判定の述語。「所属している = ACTIVE company の membership 行が存在する」を
// 唯一の基準にするため、status filter ではなく行 + ACTIVE join で数える。
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

// ADR-0010 D1: 事業所削除で当該 company の所属を物理削除する。削除行を返すので呼び出し側が
// 元メンバーごとに orphan 判定 (deleteAccountIfOrphaned) を回せる。
export async function removeMembershipsOfCompany(
  companyId: string,
  txOrDb: DbOrTx = db,
): Promise<MembershipRow[]> {
  return txOrDb.delete(membership).where(eq(membership.companyId, companyId)).returning();
}

// ADR-0010 PR-4 (backfill): D1 導入前に soft delete された company に残る ghost membership を
// 持つ company id を引く。これらは D1 後なら存在しないはずの掃除対象。
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

// role 変更 (UpdateRole)。対象 (user, company) の membership.role を更新する。
// OWNER 数が減る変更は呼び出し側で withOwnerLockGuard 内に包むこと。
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

// membership 削除 (退会 / 除名)。OWNER を減らす場合は withOwnerLockGuard 内で。
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

export type BlockingCompany = { companyId: string; companyName: string };

// DeleteUser pre-check (Q24): user が唯一の OWNER である ACTIVE company を返す。
// これらが残っている限り退会できない (退会すると OWNER ゼロの課金責任者不在 company が生まれるため)。
// 解消するには TransferOwnership で委譲するか DeleteCompany で削除する。
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
