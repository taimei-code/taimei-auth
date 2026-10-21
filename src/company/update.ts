import { Effect } from "effect";
import type { OrgCode } from "@/db/repositories/company";
import type { DbTx } from "@/db/transaction";
import { appendAuditInTx } from "../audit/append";
import { NotFound } from "../failures";
import type { VerifiedMember } from "../membership/guard";
import { Transaction } from "../transaction";
import { CompanyRepo } from "./ports";

type UpdateCompanyInput = { name: string; orgCode: OrgCode };

export const updateCompanyInfo = Effect.fnUntraced(function* (
  member: VerifiedMember<"OWNER">,
  input: UpdateCompanyInput,
) {
  const actorUserId = member.actor.id;
  const { companyId } = member;
  const companies = yield* CompanyRepo;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fnUntraced(function* (t: DbTx) {
      const before = yield* companies.findCompanyById(companyId, t);
      if (!before || before.activationStatus !== "ACTIVE") return yield* new NotFound();
      const row = yield* companies.updateCompany(companyId, input, t);
      if (!row) return yield* new NotFound();
      yield* appendAuditInTx(t, {
        eventType: "company_updated",
        userId: actorUserId,
        payload: {
          company_id: companyId,
          before: { name: before.name, org_code: before.orgCode },
          after: { name: input.name, org_code: input.orgCode },
        },
      });
      return { company: row };
    }),
  );
});
