import { recordCompanySwitched } from "@/db/repositories/audit-log";
import { findMembership } from "@/db/repositories/membership";
import { findUserById, updateUserLastUsedCompany } from "@/db/repositories/user";
import { runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): 事業所切替手続。user.last_used_company_id (secondaryStorage 構成の
// SDK companyId の source) を target に付け替える。fromCompanyId === targetCompanyId は
// 200 短絡で tx open / audit なし (「切替が発生していない」ので metric に載せない)。
// membership の存在は tx 内で再確認する: tx 外 check と更新の間に除名が入ると無効な
// company_id を last_used_company_id に書き込む TOCTOU が発生するため、findMembership の
// 再取得を tx 内に置くことで別 tx の除名 UPDATE と直列化する。
// 認可 (session 通過) は Guard 層 (requireActor) の責務。
// 設計詳細: docs/adr/0012-layered-architecture.md

export type SwitchCompanyResult =
  | { ok: true; companyId: string }
  | { ok: false; reason: "forbidden" };

export const switchCompany = async (params: {
  actorUserId: string;
  targetCompanyId: string;
}): Promise<SwitchCompanyResult> => {
  const { actorUserId, targetCompanyId } = params;
  const userRow = await findUserById(actorUserId);
  const fromCompanyId = userRow?.lastUsedCompanyId ?? null;
  if (fromCompanyId === targetCompanyId) {
    return { ok: true, companyId: targetCompanyId };
  }

  const switched = await runInTransaction(async (tx) => {
    const targetMembership = await findMembership(actorUserId, targetCompanyId, tx);
    if (!targetMembership) return false;
    await updateUserLastUsedCompany(actorUserId, targetCompanyId, tx);
    await recordCompanySwitched(
      {
        actor_user_id: actorUserId,
        from_company_id: fromCompanyId,
        to_company_id: targetCompanyId,
      },
      tx,
    );
    return true;
  });

  if (!switched) return { ok: false, reason: "forbidden" };
  return { ok: true, companyId: targetCompanyId };
};
