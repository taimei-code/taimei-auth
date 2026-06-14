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

// 事業所作成の use-case 層 (src/invitation/ と同列の feature module)。
// signup 直後の「最初の 1 事業所」と既存 user の「2 つ目以降の追加」で不変条件が違うため、
// context ごとに関数を分け、共通の生成 sequence だけ primitive に集約する。
// handler は HTTP 変換に専念し、transaction orchestration はここに閉じる。

export type CreateCompanyInput = { name: string; orgCode: OrgCode };

export type CreatedCompany = { company: CompanyRow; membership: MembershipRow };

export type SignupCompanyResult =
  | ({ ok: true } & CreatedCompany)
  | { ok: false; reason: "already_exists" };

// company + OWNER membership + last_used 更新 + audit を 1 tx で作る共有 primitive。
// last_used を新 company に更新することで「作成 = 現在の事業所を新事業所へ切替」を実現する。
// getCompanyState が current = last_used を返すため、client は作成後 refresh するだけで切り替わる。
// audit は company_created のみ記録する: 作成が切替を含意するため、明示切替 (setCurrentCompany)
// が出す company_switched は重複として省く。signup フローと同じ方針。
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

// signup フロー専用: membership 0 件の user に最初の事業所を作る。
// 2 tab 同時 submit の race を advisory lock + tx 内再 check で直列化し、
// 先着が membership を作っていれば後着は already_exists を返す (READ COMMITTED の TOCTOU 防止)。
export const createSignupCompany = (
  userId: string,
  input: CreateCompanyInput,
): Promise<SignupCompanyResult> =>
  runInTransaction(async (tx) => {
    await lockUserForCompanyCreation(tx, userId);
    const existing = await findMembershipsByUserId(userId, tx);
    if (existing.length > 0) {
      return { ok: false, reason: "already_exists" };
    }
    return { ok: true, ...(await createCompanyWithOwner(tx, userId, input)) };
  });

// 既存 user が 2 つ目以降の事業所を追加する。membership 有無を問わず作成し OWNER になる。
// signup と違い 0 件ガードは持たない (個人事業主 / 法人とも複数所有を許容 = 制限なし方針)。
// 0 件ガードが無いので advisory lock も取らない: 同一 user の並行作成で last_used がどちらの
// 新 company に落ち着くかは「最後の作成が勝つ」形で許容する (どちらも有効な所属。signup の
// TOCTOU 直列化はガードを守るための仕組みで、ガードの無い add には不要)。
export const addCompany = (userId: string, input: CreateCompanyInput): Promise<CreatedCompany> =>
  runInTransaction((tx) => createCompanyWithOwner(tx, userId, input));
