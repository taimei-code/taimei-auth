// MFA 登録状態の解釈と操作前提条件の正本実装。評決を変える変更は docs/adr/0013-mfa-totp-challenge.md
// §7 の 5 状態マトリクスの更新とセットで行う。kill-switch (MFA_CHALLENGE_ENABLED) はここに
// 混ぜない — ログイン境界のみに効かせる (混ぜた場合の帰結も同 §7 に記録済み)。
import { findTwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { TwoFactorVerificationState } from "@/db/repositories/two-factor";
import type { Actor } from "../../membership/guard/core";
import {
  ALREADY_ENABLED,
  CHALLENGE_EXPIRED,
  failure,
  type MfaFailure,
  NOT_ENABLED,
  USER_NOT_FOUND,
} from "../error-mapping";
import { requiresMfaChallenge } from "../policy";
import type { RegistrationSnapshot } from "./ports";

type EnrollmentRecord = "absent" | "unverified";

type MfaEnrollmentState =
  | { kind: "none" }
  | { kind: "enrolled_pending" }
  | { kind: "active" }
  | { kind: "interrupted_disable" }
  | { kind: "interrupted_activate"; enrollmentRecord: EnrollmentRecord };

function classifyEnrollment(
  challengeRequired: boolean,
  record: { verified: boolean } | undefined,
): MfaEnrollmentState {
  if (challengeRequired) {
    if (record?.verified) return { kind: "active" };
    return { kind: "interrupted_activate", enrollmentRecord: record ? "unverified" : "absent" };
  }
  if (!record) return { kind: "none" };
  return record.verified ? { kind: "interrupted_disable" } : { kind: "enrolled_pending" };
}

export function enrollmentRecordIn(
  snapshot: RegistrationSnapshot,
): TwoFactorVerificationState | undefined {
  return snapshot.user === "present" ? snapshot.enrollment : undefined;
}

// guard lease の snapshot を DB 再読みより優先する (取得 transaction が読んだ状態で判定を確定する)。
export async function currentEnrollment(
  actor: Actor,
  snapshot?: RegistrationSnapshot,
): Promise<TwoFactorVerificationState | undefined> {
  return snapshot ? enrollmentRecordIn(snapshot) : await findTwoFactorVerificationState(actor.id);
}

async function readState(
  actor: Actor,
  snapshot?: RegistrationSnapshot,
): Promise<MfaEnrollmentState> {
  if (snapshot) {
    return classifyEnrollment(
      snapshot.user === "present" && requiresMfaChallenge(snapshot),
      enrollmentRecordIn(snapshot),
    );
  }
  return classifyEnrollment(
    requiresMfaChallenge(actor),
    await findTwoFactorVerificationState(actor.id),
  );
}

function isMfaInEffect(state: MfaEnrollmentState): boolean {
  switch (state.kind) {
    case "active":
    case "interrupted_disable":
    case "interrupted_activate":
      return true;
    case "none":
    case "enrolled_pending":
      return false;
  }
}

export async function ensureCanEnroll(
  actor: Actor,
  snapshot?: RegistrationSnapshot,
): Promise<MfaFailure | undefined> {
  return isMfaInEffect(await readState(actor, snapshot)) ? failure(ALREADY_ENABLED) : undefined;
}

export async function ensureCanActivate(
  actor: Actor,
  snapshot?: RegistrationSnapshot,
): Promise<MfaFailure | undefined> {
  const state = await readState(actor, snapshot);
  if (isMfaInEffect(state)) return failure(ALREADY_ENABLED);
  if (state.kind === "none") return failure(USER_NOT_FOUND);
  return undefined;
}

export async function ensureDisableCanProceed(
  actor: Actor,
  snapshot?: RegistrationSnapshot,
): Promise<MfaFailure | undefined> {
  const state = await readState(actor, snapshot);
  if (!isMfaInEffect(state)) return failure(NOT_ENABLED);
  if (state.kind === "interrupted_activate" && state.enrollmentRecord === "absent") {
    return failure(CHALLENGE_EXPIRED);
  }
  return undefined;
}

export async function readEnrollmentFacts(actor: Actor): Promise<{
  inEffect: boolean;
  interrupted?: { enrollmentRecord: EnrollmentRecord };
}> {
  const state = await readState(actor);
  return {
    inEffect: isMfaInEffect(state),
    interrupted:
      state.kind === "interrupted_activate"
        ? { enrollmentRecord: state.enrollmentRecord }
        : undefined,
  };
}
