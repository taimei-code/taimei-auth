import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { Actor } from "../membership/guard/core";
import { ALREADY_ENABLED, failure, type MfaFailure } from "./error-mapping";
import { enrollTotp, type TotpEnrollment } from "./gateway";
import { requiresMfaChallenge } from "./policy";

// ADR-0012 (Use-case 層): 認証アプリの登録手続。TOTP secret とリカバリーコードを新規発行し、
// 未 verified の two_factor 行を作る。有効化 (verified 化) は activate が行う。

export type EnrollResult = ({ ok: true } & TotpEnrollment) | MfaFailure;

// **有効化済みユーザーの再 enroll を必ず拒む**。プラグインの enable は既存 two_factor 行を
// 無条件に deleteMany し、既存行が verified だった場合は新しい行も verified: true で作る。
// そのまま通すと、本人が知らない secret とリカバリーコードに黙って差し替わり、手元の認証アプリが
// 通らなくなる = 恒久ロックアウトになる。再登録は disable → enroll の 2 段だけを正規経路とする。
//
// verified: false のまま放棄された行が残っている場合は再 enroll を受理してよい。プラグインの
// deleteMany + create で 1 行に収束し、まだ誰も使っていない secret が捨てられるだけで害が無い。
export async function enroll(actor: Actor, headers: Headers): Promise<EnrollResult> {
  if (requiresMfaChallenge(actor)) return failure(ALREADY_ENABLED);
  // フラグだけでなく verified 行も見るのは、プラグインの disable がフラグ降ろし → 行削除の順で書き、
  // 中断すると twoFactorEnabled:false と verified 行が同居しうるため (上記の継承がそのまま発火する)。
  const enrollment = await findTwoFactorVerificationState(actor.id);
  if (enrollment?.verified) return failure(ALREADY_ENABLED);

  const enrolled = await enrollTotp(headers);
  if (!enrolled.ok) return enrolled;
  return { ok: true, ...enrolled.value };
}
