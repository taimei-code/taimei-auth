import { recordCompanyUpdated } from "@/db/repositories/audit-log";
import {
  type CompanyRow,
  findCompanyById,
  type OrgCode,
  updateCompany,
} from "@/db/repositories/company";
import { runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): 事業所編集手続。before/after diff を tx 内で集めるのは、tx 外だと別 tx の update と
// 混線して audit の before が現行値とずれる silent drift が起きるため。inactive company は not_found を返す。

export type UpdateCompanyInput = { name: string; orgCode: OrgCode };

export type UpdateCompanyResult =
  | { ok: true; company: CompanyRow }
  | { ok: false; reason: "not_found" };

export const updateCompanyInfo = (params: {
  actorUserId: string;
  companyId: string;
  input: UpdateCompanyInput;
}): Promise<UpdateCompanyResult> => {
  const { actorUserId, companyId, input } = params;
  return runInTransaction(async (tx): Promise<UpdateCompanyResult> => {
    const before = await findCompanyById(companyId, tx);
    if (!before || before.activationStatus !== "ACTIVE") {
      return { ok: false, reason: "not_found" };
    }
    const row = await updateCompany(companyId, input, tx);
    if (!row) return { ok: false, reason: "not_found" };
    await recordCompanyUpdated(
      {
        actor_user_id: actorUserId,
        company_id: companyId,
        before: { name: before.name, org_code: before.orgCode as OrgCode },
        after: { name: input.name, org_code: input.orgCode },
      },
      tx,
    );
    return { ok: true, company: row };
  });
};
