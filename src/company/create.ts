import { Effect } from "effect";
import type { CompanyRow, OrgCode } from "@/db/repositories/company";
import type { MembershipRow } from "@/db/repositories/membership";
import type { DbTx } from "@/db/transaction";
import { UserRepo } from "../account/ports";
import { AuditLog } from "../audit/ports";
import { IdGenerator } from "../id-generator";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { AlreadyExists } from "./errors";
import { CompanyRepo } from "./ports";

type CreateCompanyInput = { name: string; orgCode: OrgCode };

export type CreatedCompany = { company: CompanyRow; membership: MembershipRow };

const createCompanyWithOwner = Effect.fn("company.createCompanyWithOwner")(function* (
  tx: DbTx,
  userId: string,
  input: CreateCompanyInput,
) {
  const companies = yield* CompanyRepo;
  const memberships = yield* MembershipRepo;
  const users = yield* UserRepo;
  const audit = yield* AuditLog;
  const ids = yield* IdGenerator;

  const companyId = ids.companyId();
  const created = yield* companies.insertCompany(
    { id: companyId, name: input.name, orgCode: input.orgCode },
    tx,
  );
  const membership = yield* memberships.insertMembership(
    { id: ids.membershipId(), userId, companyId, role: "OWNER" },
    tx,
  );
  yield* users.updateUserLastUsedCompany(userId, companyId, tx);
  yield* audit.recordCompanyCreated(
    { actor_user_id: userId, company_id: companyId, name: input.name, org_code: input.orgCode },
    tx,
  );
  return { company: created, membership } satisfies CreatedCompany;
});

// 2 つの tab からの同時 submit は advisory lock と tx 内の再チェックで直列化する (xact lock は rollback でも解放される)。
export const createSignupCompany = Effect.fn("company.createSignupCompany")(function* (
  userId: string,
  input: CreateCompanyInput,
) {
  const memberships = yield* MembershipRepo;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("company.createSignupCompany.apply")(function* (t: DbTx) {
      yield* memberships.lockUserForCompanyCreation(t, userId);
      // ACTIVE だけを数えるのは、soft delete された行が残るため、全件で数えると再 signup が redirect loop になるから。
      const rows = yield* memberships.findMembershipsByUserId(userId, t);
      if (rows.some((m) => m.companyActivationStatus === "ACTIVE")) {
        return yield* new AlreadyExists();
      }
      return yield* createCompanyWithOwner(t, userId, input);
    }),
  );
});

export const addCompany = Effect.fn("company.addCompany")(function* (
  userId: string,
  input: CreateCompanyInput,
) {
  const tx = yield* Transaction;
  return yield* tx.run((t) => createCompanyWithOwner(t, userId, input));
});
