import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import { CHALLENGE_EXPIRED, failure } from "../error-mapping";
import type { RegistrationOperations } from "./ports";
import { ensureCanEnroll, enrollmentRecordIn } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの登録手続。TOTP secret とリカバリーコードを新規発行し、
// 未 verified の two_factor 行を作る。有効化 (verified 化) は activate が行う。
// 再 enroll を拒む条件と理由 (通すと本人が知らない secret へ黙って差し替わる) の正本は
// docs/adr/0013-mfa-totp-challenge.md の 5 状態マトリクス。
//
// actorFromSnapshot (snapshot 優先の属性上書き) は適用しない — この operation が使うのは actor.id
// だけで、id は上書きの対象外。email / flag を消費する activate / disable のみが適用する。

export const enroll: RegistrationOperations["enroll"] = async ({
  actor,
  headers,
  snapshot,
  gateway,
}) => {
  const rejected = ensureCanEnroll(snapshot);
  if (rejected) return rejected;

  const current = enrollmentRecordIn(snapshot);
  if (current && !current.verified) {
    const replayed = await gateway.readPendingTotpEnrollment(actor, headers);
    if (!replayed.ok) return replayed;
    return { ok: true, enrollmentId: current.id, ...replayed.value };
  }

  const enrolled = await gateway.enrollTotp(headers);
  if (!enrolled.ok) return enrolled;
  const created = await findTwoFactorVerificationState(actor.id);
  if (!created) return failure(CHALLENGE_EXPIRED);
  return { ok: true, enrollmentId: created.id, ...enrolled.value };
};
