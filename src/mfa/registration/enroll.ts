import type { Actor } from "../../membership/guard/core";
import { CHALLENGE_EXPIRED, failure } from "../error-mapping";
import { enrollTotp, readPendingTotpEnrollment } from "../gateway";
import type { EnrollResult } from "./contracts";
import type { RegistrationSnapshot } from "./ports";
import { ensureCanEnroll, enrollmentRecordIn } from "./state";
import { readCurrentEnrollment } from "./state-reader";

// ADR-0012 (Use-case 層): 認証アプリの登録手続。TOTP secret とリカバリーコードを新規発行し、
// 未 verified の two_factor 行を作る。有効化 (verified 化) は activate が行う。
// 再 enroll を拒む条件と理由 (通すと本人が知らない secret へ黙って差し替わる) の正本は
// docs/adr/0013-mfa-totp-challenge.md の 5 状態マトリクス。

export async function enroll(
  actor: Actor,
  headers: Headers,
  snapshot: RegistrationSnapshot,
): Promise<EnrollResult> {
  const rejected = ensureCanEnroll(snapshot);
  if (rejected) return rejected;

  const current = enrollmentRecordIn(snapshot);
  if (current && !current.verified) {
    const replayed = await readPendingTotpEnrollment(actor, headers);
    if (!replayed.ok) return replayed;
    return { ok: true, enrollmentId: current.id, ...replayed.value };
  }

  const enrolled = await enrollTotp(headers);
  if (!enrolled.ok) return enrolled;
  const created = await readCurrentEnrollment(actor);
  if (!created) return failure(CHALLENGE_EXPIRED);
  return { ok: true, enrollmentId: created.id, ...enrolled.value };
}
