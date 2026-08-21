import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import { ENROLLMENT_CHANGED, failure } from "../error-mapping";
import { enrollTotp } from "../gateway";
import type { RegistrationOperations } from "./ports";
import { ensureCanActivate, enrollmentRecordIn } from "./state";

// ADR-0012 (Use-case 層): MFA 登録やり直し — 登録済み未有効の内容を明示的に破棄し、新しい secret・
// リカバリーコード・登録識別子へ回転する。移行第 2 段階まで façade 非公開 (公開条件: ADR-0013 §8、
// 非公開の固定: containment.test.ts QA-E-03)。
//
// actorFromSnapshot は適用しない — 使うのは actor.id だけで、id は上書きの対象外 (理由の詳細: enroll.ts)。

export const restart: RegistrationOperations["restart"] = async ({
  actor,
  headers,
  enrollmentId,
  snapshot,
}) => {
  const rejected = ensureCanActivate(snapshot);
  if (rejected) return rejected;
  const current = enrollmentRecordIn(snapshot);
  if (current?.id !== enrollmentId) return failure(ENROLLMENT_CHANGED);

  const enrolled = await enrollTotp(headers);
  if (!enrolled.ok) return enrolled;
  const replacement = await findTwoFactorVerificationState(actor.id);
  if (!replacement) return failure(ENROLLMENT_CHANGED);
  return { ok: true, enrollmentId: replacement.id, ...enrolled.value };
};
