import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "../client";
import { company } from "../schema";
import type { DbOrTx } from "../transaction";

// ADR-009: company.id は Stripe 流の `cmp_<24chars>` prefix で format 統一。
// 観測性 (log / audit_log payload / error message) で entity type が直ちに判定可能になる。
// TS = nanoid(24), SQL (backfill) = translate(encode(gen_random_bytes(18), 'base64'), '+/=', '-_') で alphabet/長さを揃える。
export const generateCompanyId = (): string => `cmp_${nanoid(24)}`;

export type CompanyRow = typeof company.$inferSelect;
export type OrgCode = "PERSONAL" | "CORPORATE";

export async function findCompanyById(
  id: string,
  txOrDb: DbOrTx = db,
): Promise<CompanyRow | undefined> {
  return txOrDb
    .select()
    .from(company)
    .where(eq(company.id, id))
    .limit(1)
    .then((rows) => rows.at(0));
}

export async function insertCompany(
  params: { id: string; name: string; orgCode: OrgCode },
  txOrDb: DbOrTx = db,
): Promise<CompanyRow> {
  return txOrDb
    .insert(company)
    .values({
      id: params.id,
      name: params.name,
      orgCode: params.orgCode,
      activationStatus: "ACTIVE",
    })
    .returning()
    .then((rows) => {
      const row = rows.at(0);
      if (!row) {
        throw new Error("company INSERT returned no row");
      }
      return row;
    });
}

// name / org_code の更新 (UpdateCompany)。ACTIVE な company のみ対象。
export async function updateCompany(
  id: string,
  updates: { name: string; orgCode: OrgCode },
  txOrDb: DbOrTx = db,
): Promise<CompanyRow | undefined> {
  return txOrDb
    .update(company)
    .set({ name: updates.name, orgCode: updates.orgCode })
    .where(and(eq(company.id, id), eq(company.activationStatus, "ACTIVE")))
    .returning()
    .then((rows) => rows.at(0));
}

// soft delete (DeleteCompany)。activation_status=DELETED + deleted_at をセット。
// membership / invitation 行は残す (物理削除は本 ADR スコープ外)。ACTIVE のみ削除可能。
export async function softDeleteCompany(
  id: string,
  txOrDb: DbOrTx = db,
): Promise<CompanyRow | undefined> {
  return txOrDb
    .update(company)
    .set({ activationStatus: "DELETED", deletedAt: new Date() })
    .where(and(eq(company.id, id), eq(company.activationStatus, "ACTIVE")))
    .returning()
    .then((rows) => rows.at(0));
}
