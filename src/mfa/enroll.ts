import type { Actor } from "../membership/guard/core";
import { ensureCanEnroll } from "./enrollment-state";
import type { MfaFailure } from "./error-mapping";
import { enrollTotp, type TotpEnrollment } from "./gateway";

// ADR-0012 (Use-case 層): 認証アプリの登録手続。TOTP secret とリカバリーコードを新規発行し、
// 未 verified の two_factor 行を作る。有効化 (verified 化) は activate が行う。
// 再 enroll を拒む条件と理由 (通すと本人が知らない secret へ黙って差し替わる) の正本は
// docs/adr/0013-mfa-totp-challenge.md の 5 状態マトリクス。

export type EnrollResult = ({ ok: true } & TotpEnrollment) | MfaFailure;

export async function enroll(actor: Actor, headers: Headers): Promise<EnrollResult> {
  const rejected = await ensureCanEnroll(actor);
  if (rejected) return rejected;

  const enrolled = await enrollTotp(headers);
  if (!enrolled.ok) return enrolled;
  return { ok: true, ...enrolled.value };
}
