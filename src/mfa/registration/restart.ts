import type { Actor } from "../../membership/guard/core";
import { ENROLLMENT_CHANGED, failure } from "../error-mapping";
import { enrollTotp } from "../gateway";
import type { RestartResult } from "./contracts";
import type { RegistrationSnapshot } from "./ports";
import { currentEnrollment, ensureCanActivate } from "./state";

export async function restart(params: {
  actor: Actor;
  headers: Headers;
  enrollmentId: string;
  snapshot?: RegistrationSnapshot;
}): Promise<RestartResult> {
  const rejected = await ensureCanActivate(params.actor, params.snapshot);
  if (rejected) return rejected;
  const current = await currentEnrollment(params.actor, params.snapshot);
  if (current?.id !== params.enrollmentId) return failure(ENROLLMENT_CHANGED);

  const enrolled = await enrollTotp(params.headers);
  if (!enrolled.ok) return enrolled;
  const replacement = await currentEnrollment(params.actor);
  if (!replacement) return failure(ENROLLMENT_CHANGED);
  return { ok: true, enrollmentId: replacement.id, ...enrolled.value };
}
