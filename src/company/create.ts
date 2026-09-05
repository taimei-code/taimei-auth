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

// ADR-0012 (Use-case 層): signup 直後の「最初の 1 事業所」と既存 user の「追加」で不変条件が違うため
// context ごとに関数を分け、共通の生成 sequence だけ primitive に集約する。tx 所有はここに閉じる。

export type CreateCompanyInput = { name: string; orgCode: OrgCode };

export type CreatedCompany = { company: CompanyRow; membership: MembershipRow };

// company + OWNER membership + last_used 更新 + audit を 1 tx で作る共有 primitive。last_used 更新で
// 「作成 = 現在の事業所へ切替」を実現し、audit は company_created のみ (切替は重複なので省く)。
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

// signup フロー専用: membership 0 件の user に最初の事業所を作る。2 tab 同時 submit の race を
// advisory lock + tx 内再 check で直列化し、先着済みなら AlreadyExists を E に載せる (TOCTOU 防止)。
// advisory lock は pg_advisory_xact_lock なので、failure による rollback でも tx 終了時に解放される。
export const createSignupCompany = Effect.fn("company.createSignupCompany")(function* (
  userId: string,
  input: CreateCompanyInput,
) {
  const memberships = yield* MembershipRepo;
  const tx = yield* Transaction;

  return yield* tx.run(
    Effect.fn("company.createSignupCompany.apply")(function* (t: DbTx) {
      yield* memberships.lockUserForCompanyCreation(t, userId);
      // ACTIVE 基準で数えるのは soft delete が membership 行を残すため。全 membership で数えると「全削除した
      // user」が残存行に弾かれ、再 signup が redirect loop に陥る。SPA / 一覧 API と同基準。
      const rows = yield* memberships.findMembershipsByUserId(userId, t);
      if (rows.some((m) => m.companyActivationStatus === "ACTIVE")) {
        return yield* new AlreadyExists();
      }
      return yield* createCompanyWithOwner(t, userId, input);
    }),
  );
});

// 既存 user が 2 つ目以降を追加する。signup と違い 0 件ガードを持たないため advisory lock も取らない
// (並行作成で last_used がどちらに落ち着くかは「最後の作成が勝つ」形で許容する)。domain failure は無い。
export const addCompany = Effect.fn("company.addCompany")(function* (
  userId: string,
  input: CreateCompanyInput,
) {
  const tx = yield* Transaction;
  return yield* tx.run((t) => createCompanyWithOwner(t, userId, input));
});
