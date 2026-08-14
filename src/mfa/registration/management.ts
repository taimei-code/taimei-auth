import {
  readRegistrationGuardProtocolVersion,
  releaseRegistrationGuardByManagement,
} from "@/db/repositories/mfa-registration";
import { findUserById } from "@/db/repositories/user";
import type { MfaFailure } from "../error-mapping";
import { forceDisableMfa, type ForceDisableResult } from "./force-disable";
import { reportUnknownMfaRegistrationTransition } from "./observability-adapter";
import { createTransitionRunner, type TransitionBusy } from "./transition";
import { registrationGuard } from "./wiring";

export const MFA_REGISTRATION_GUARD_PROTOCOL_VERSION = 1;

export function assertRegistrationGuardProtocolVersion(version: number | undefined): void {
  if (version === MFA_REGISTRATION_GUARD_PROTOCOL_VERSION) return;
  throw new Error(
    `MFA registration guard protocol mismatch: expected ${MFA_REGISTRATION_GUARD_PROTOCOL_VERSION}, got ${version ?? "missing"}`,
  );
}

async function assertGuardProtocol(): Promise<void> {
  assertRegistrationGuardProtocolVersion(await readRegistrationGuardProtocolVersion());
}

const runTransition = createTransitionRunner(
  registrationGuard,
  reportUnknownMfaRegistrationTransition,
);

export async function forceDisable(
  userId: string,
): Promise<ForceDisableResult | TransitionBusy | MfaFailure> {
  await assertGuardProtocol();
  // guard 取得前の存在確認は user_not_found を FK 違反由来の 503 に化けさせないための advisory。
  // 正式な判定は guard 取得後の snapshot が行う。
  if (!(await findUserById(userId))) return { ok: false, reason: "user_not_found" };
  return runTransition(userId, "force_disable", (snapshot) => forceDisableMfa(userId, snapshot));
}

export async function forceReleaseRegistrationGuard(input: {
  userId: string;
  source: string;
  reason: string;
  processStoppedConfirmed: boolean;
}): Promise<
  { ok: true; released: boolean } | { ok: false; reason: "invalid_release_confirmation" }
> {
  const source = input.source.trim();
  const reason = input.reason.trim();
  if (!input.processStoppedConfirmed || source.length === 0 || reason.length === 0) {
    return { ok: false, reason: "invalid_release_confirmation" };
  }
  await assertGuardProtocol();
  const result = await releaseRegistrationGuardByManagement({
    userId: input.userId,
    source,
    reason,
    processStoppedConfirmed: input.processStoppedConfirmed,
  });
  return { ok: true, released: result.released };
}
