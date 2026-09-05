import { Effect } from "effect";
import type { OrgCode } from "@/db/repositories/company";
import type { DbTx } from "@/db/transaction";
import { AuditLog } from "../audit/ports";
import { NotFound } from "../membership/guard/errors";
import { Transaction } from "../transaction";
import { CompanyRepo } from "./ports";

// ADR-0012 (Use-case 層): 事業所編集手続。before/after diff を tx 内で集めるのは、tx 外だと別 tx の update と
// 混線して audit の before が現行値とずれる silent drift が起きるため。inactive company は NotFound を E に載せる
// (failure は tx ごと rollback されるので audit は残らない)。

export type UpdateCompanyInput = { name: string; orgCode: OrgCode };

export const updateCompanyInfo = Effect.fn("company.updateCompanyInfo")(function* (params: {
  actorUserId: string;
  companyId: string;
  input: UpdateCompanyInput;
}) {
  const { actorUserId, companyId, input } = params;
  const companies = yield* CompanyRepo;
  const audit = yield* AuditLog;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("company.updateCompanyInfo.apply")(function* (t: DbTx) {
      const before = yield* companies.findById(companyId, t);
      if (!before || before.activationStatus !== "ACTIVE") return yield* new NotFound();
      const row = yield* companies.update(companyId, input, t);
      if (!row) return yield* new NotFound();
      yield* audit.recordCompanyUpdated(
        {
          actor_user_id: actorUserId,
          company_id: companyId,
          before: { name: before.name, org_code: before.orgCode as OrgCode },
          after: { name: input.name, org_code: input.orgCode },
        },
        t,
      );
      return { company: row };
    }),
  );
});
