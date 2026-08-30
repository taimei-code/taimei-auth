// MFA 登録状態の解釈と操作前提条件の正本実装。評決を変える変更は ADR-0013 §7 の 5 状態マトリクスの
// 更新とセットで行う。kill-switch (MFA_CHALLENGE_ENABLED) はここに混ぜない (帰結も同 §7)。
import {
  ALREADY_ENABLED,
  CHALLENGE_EXPIRED,
  failure,
  type MfaFailure,
  NOT_ENABLED,
  USER_NOT_FOUND,
} from "../error-mapping";
import { requiresMfaChallenge } from "../policy";
import type { MfaActor } from "./contracts";
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

export function enrollmentRecordIn(snapshot: RegistrationSnapshot) {
  return snapshot.user === "present" ? snapshot.enrollment : undefined;
}

// 属性 (email / twoFactorEnabled) は snapshot が正 — request の値は guard 取得までに古びうる。
// id は snapshot に無く、session から解決した actor が正。
export function actorFromSnapshot(actor: MfaActor, snapshot: RegistrationSnapshot): MfaActor {
  return {
    id: actor.id,
    email: snapshot.user === "present" ? snapshot.email : actor.email,
    twoFactorEnabled: snapshot.user === "present" ? snapshot.twoFactorEnabled : false,
  };
}

function stateIn(snapshot: RegistrationSnapshot): MfaEnrollmentState {
  return classifyEnrollment(
    snapshot.user === "present" && requiresMfaChallenge(snapshot),
    enrollmentRecordIn(snapshot),
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

export function ensureCanEnroll(snapshot: RegistrationSnapshot): MfaFailure | undefined {
  return isMfaInEffect(stateIn(snapshot)) ? failure(ALREADY_ENABLED) : undefined;
}

export function ensureCanActivate(snapshot: RegistrationSnapshot): MfaFailure | undefined {
  const state = stateIn(snapshot);
  if (isMfaInEffect(state)) return failure(ALREADY_ENABLED);
  if (state.kind === "none") return failure(USER_NOT_FOUND);
  return undefined;
}

export function ensureDisableCanProceed(snapshot: RegistrationSnapshot): MfaFailure | undefined {
  const state = stateIn(snapshot);
  if (!isMfaInEffect(state)) return failure(NOT_ENABLED);
  if (state.kind === "interrupted_activate" && state.enrollmentRecord === "absent") {
    return failure(CHALLENGE_EXPIRED);
  }
  return undefined;
}

// チャレンジ要否の評価をこの関数内に閉じ、呼び出し側に boolean を組ませず述語を必ず通す。
export function enrollmentFactsFor(
  actor: MfaActor,
  enrollment: { verified: boolean } | undefined,
): {
  inEffect: boolean;
  interrupted?: { enrollmentRecord: EnrollmentRecord };
} {
  const state = classifyEnrollment(requiresMfaChallenge(actor), enrollment);
  return {
    inEffect: isMfaInEffect(state),
    interrupted:
      state.kind === "interrupted_activate"
        ? { enrollmentRecord: state.enrollmentRecord }
        : undefined,
  };
}
