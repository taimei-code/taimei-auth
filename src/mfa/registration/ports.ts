import type { MfaFailure } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { EnrollResult, MfaActor, RestartResult, TotpEnrollment } from "./contracts";
import type {
  AcquireRegistrationGuardResult,
  GuardHold,
  RegistrationOperationKind,
  RegistrationSnapshot,
} from "@/db/repositories/mfa-registration";

// guard 型の正本は snapshot を作る側の db/repositories/mfa-registration.ts (db → src 依存を作らない)。
export type {
  AcquireRegistrationGuardResult,
  GuardHold,
  RegistrationOperationKind,
  RegistrationSnapshot,
} from "@/db/repositories/mfa-registration";

export type TransitionGuard = {
  acquire(
    userId: string,
    operation: RegistrationOperationKind,
  ): Promise<AcquireRegistrationGuardResult>;
  release(hold: GuardHold): Promise<{ released: boolean }>;
};

export type TotpEnrollmentResult =
  | { ok: true; value: TotpEnrollment; headers: Headers }
  | MfaFailure;

// runTransition が work へ配る遷移内専用の better-auth 窓口。写像方針 (書き込み = rethrow /
// readPendingTotpEnrollment = 総写像) は関数選定に内部固定 — 正本: ADR-0013 §8。
export type GuardedMfaGateway = {
  enrollTotp(headers: Headers): Promise<TotpEnrollmentResult>;
  readPendingTotpEnrollment(actor: MfaActor, headers: Headers): Promise<TotpEnrollmentResult>;
  verifyCode(
    headers: Headers,
    input: { code: string; kind: MfaCodeKind },
  ): Promise<SessionMutationResult>;
  activateTotp(headers: Headers, code: string): Promise<SessionMutationResult>;
  disableTotp(headers: Headers): Promise<SessionMutationResult>;
  revokeOtherSessions(headers: Headers): Promise<SessionMutationResult>;
};

// hold は作る資格の証憑 (束縛材料ではない)。正本: ADR-0013 §8。
export type GuardedGatewayFactory = (hold: GuardHold) => GuardedMfaGateway;

export type SessionMutationResult = { ok: true; headers: Headers } | MfaFailure;

export type AuditInput = {
  userId: string;
  ip: string | null;
  userAgent: string;
};

// deps に残るのは自前持ちの周辺 (試行枠・audit・観測) だけ。better-auth 窓口は deps でなく
// operations 入力の GuardedMfaGateway で届く (runTransition が配る)。
export type ActivateDependencies = {
  writeAudit(input: AuditInput): Promise<void>;
  // Observer は例外を投げず、確定済みの登録遷移を変更しない。
  observeAuditError(error: unknown): void;
};

export type DisableDependencies = {
  spendAttempt(userId: string): Promise<MfaFailure | undefined>;
  resetAttempts(userId: string): Promise<void>;
  writeAudit(input: AuditInput): Promise<void>;
  // Observer は例外を投げず、確定済みの登録遷移を変更しない。
  observeAuditError(error: unknown): void;
};

// 各 operation の gateway は使う能力だけの Pick で受ける (least-privilege) — enroll が disableTotp を
// 呼べる等の全能力面を型で塞ぐ。runner が配る実体は GuardedMfaGateway 全体 (部分型で受かる)。
export type RegistrationOperations = {
  enroll(input: {
    actor: MfaActor;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    gateway: Pick<GuardedMfaGateway, "enrollTotp" | "readPendingTotpEnrollment">;
  }): Promise<EnrollResult>;
  restart(input: {
    actor: MfaActor;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    gateway: Pick<GuardedMfaGateway, "enrollTotp">;
    enrollmentId: string;
  }): Promise<RestartResult>;
  activate(input: {
    actor: MfaActor;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    gateway: Pick<GuardedMfaGateway, "revokeOtherSessions" | "activateTotp">;
    enrollmentId?: string;
    code: string;
  }): Promise<{ ok: true; sessionChanges: Headers; notifyEmail: string } | MfaFailure>;
  disable(input: {
    actor: MfaActor;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    gateway: Pick<GuardedMfaGateway, "verifyCode" | "revokeOtherSessions" | "disableTotp">;
    code: string;
    kind: MfaCodeKind;
  }): Promise<{ ok: true; sessionChanges: Headers; notifyEmail: string } | MfaFailure>;
};
