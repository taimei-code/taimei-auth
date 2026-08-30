import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import { CHALLENGE_EXPIRED, failure } from "../error-mapping";
import type { RegistrationOperations } from "./ports";
import { ensureCanEnroll, enrollmentRecordIn } from "./state";

// ADR-0012 (Use-case 層): 認証アプリの登録手続。有効化 (verified 化) は activate が行う。
// 再 enroll を拒む条件と理由 (通すと本人が知らない secret へ黙って差し替わる) の正本: ADR-0013 §7。
// actorFromSnapshot を適用しないのは、使うのが actor.id だけで id は上書きの対象外だから。

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
