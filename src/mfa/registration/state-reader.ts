import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { TwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { Actor } from "../../membership/guard/core";
import { enrollmentFactsFor } from "./state";

export async function readCurrentEnrollment(
  actor: Actor,
): Promise<TwoFactorVerificationState | undefined> {
  return findTwoFactorVerificationState(actor.id);
}

export async function readEnrollmentFacts(actor: Actor) {
  return enrollmentFactsFor(actor, await readCurrentEnrollment(actor));
}
