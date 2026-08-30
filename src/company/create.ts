import { runInTransaction, type DbTx } from "@/db/transaction";
import {
  generateCompanyId,
  insertCompany,
  type CompanyRow,
  type OrgCode,
} from "@/db/repositories/company";
import {
  findMembershipsByUserId,
  generateMembershipId,
  insertMembership,
  lockUserForCompanyCreation,
  type MembershipRow,
} from "@/db/repositories/membership";
import { recordCompanyCreated } from "@/db/repositories/audit-log";
import { updateUserLastUsedCompany } from "@/db/repositories/user";

// ADR-0012 (Use-case 層): signup 直後の「最初の 1 事業所」と既存 user の「追加」で不変条件が違うため
// context ごとに関数を分け、共通の生成 sequence だけ primitive に集約する。tx 所有はここに閉じる。

export type CreateCompanyInput = { name: string; orgCode: OrgCode };

export type CreatedCompany = { company: CompanyRow; membership: MembershipRow };

export type SignupCompanyResult =
  | ({ ok: true } & CreatedCompany)
  | { ok: false; reason: "already_exists" };

// company + OWNER membership + last_used 更新 + audit を 1 tx で作る共有 primitive。last_used 更新で
// 「作成 = 現在の事業所へ切替」を実現し、audit は company_created のみ (切替は重複なので省く)。
async function createCompanyWithOwner(
  tx: DbTx,
  userId: string,
  input: CreateCompanyInput,
): Promise<CreatedCompany> {
  const companyId = generateCompanyId();
  const company = await insertCompany(
    { id: companyId, name: input.name, orgCode: input.orgCode },
    tx,
  );
  const membership = await insertMembership(
    { id: generateMembershipId(), userId, companyId, role: "OWNER" },
    tx,
  );
  await updateUserLastUsedCompany(userId, companyId, tx);
  await recordCompanyCreated(
    { actor_user_id: userId, company_id: companyId, name: input.name, org_code: input.orgCode },
    tx,
  );
  return { company, membership };
}

// signup フロー専用: membership 0 件の user に最初の事業所を作る。2 tab 同時 submit の race を
// advisory lock + tx 内再 check で直列化し、先着済みなら already_exists を返す (TOCTOU 防止)。
export const createSignupCompany = (
  userId: string,
  input: CreateCompanyInput,
): Promise<SignupCompanyResult> =>
  runInTransaction(async (tx) => {
    await lockUserForCompanyCreation(tx, userId);
    // ACTIVE 基準で数えるのは soft delete が membership 行を残すため。全 membership で数えると「全削除した
    // user」が残存行に弾かれ、再 signup が redirect loop に陥る。SPA / 一覧 API と同基準。
    const memberships = await findMembershipsByUserId(userId, tx);
    const alreadyBelongsToActiveCompany = memberships.some(
      (m) => m.companyActivationStatus === "ACTIVE",
    );
    if (alreadyBelongsToActiveCompany) {
      return { ok: false, reason: "already_exists" };
    }
    return { ok: true, ...(await createCompanyWithOwner(tx, userId, input)) };
  });

// 既存 user が 2 つ目以降を追加する。signup と違い 0 件ガードを持たないため advisory lock も取らない
// (並行作成で last_used がどちらに落ち着くかは「最後の作成が勝つ」形で許容する)。
export const addCompany = (userId: string, input: CreateCompanyInput): Promise<CreatedCompany> =>
  runInTransaction((tx) => createCompanyWithOwner(tx, userId, input));
