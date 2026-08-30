import { recordCompanySwitched } from "@/db/repositories/audit-log";
import { findMembership } from "@/db/repositories/membership";
import { updateUserLastUsedCompany } from "@/db/repositories/user";
import { runInTransaction } from "@/db/transaction";

// ADR-0012 (Use-case 層): 事業所切替手続。last_used_company_id を target に付け替える。同一 company は
// 200 短絡で tx / audit なし。fromCompanyId は guard が読んだ同 request の user 行から受け取る (再 SELECT を避ける)。
// membership の存在は tx 内で再確認する — tx 外 check と更新の間に除名が入る TOCTOU を直列化するため。

export type SwitchCompanyResult =
  | { ok: true; companyId: string }
  | { ok: false; reason: "forbidden" };

export const switchCompany = async (params: {
  actorUserId: string;
  fromCompanyId: string | null;
  targetCompanyId: string;
}): Promise<SwitchCompanyResult> => {
  const { actorUserId, fromCompanyId, targetCompanyId } = params;
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
