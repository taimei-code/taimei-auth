import type { MfaFailure } from "../error-mapping";
import type { MfaCodeKind } from "../wire-contracts";
import type { EnrollResult, RegistrationPrincipal, RestartResult } from "./contracts";
import type { MfaStatus } from "./status";
import type {
  AcquireRegistrationGuardResult,
  GuardLease,
  RegistrationOperationKind,
  RegistrationSnapshot,
} from "@/db/repositories/mfa-registration";

// guard 型の正本は snapshot を作る側の db/repositories/mfa-registration.ts (db → src 依存を作らない)。
export type {
  AcquireRegistrationGuardResult,
  GuardLease,
  RegistrationOperationKind,
  RegistrationSnapshot,
} from "@/db/repositories/mfa-registration";

export type TransitionGuard = {
  acquire(
    userId: string,
    operation: RegistrationOperationKind,
  ): Promise<AcquireRegistrationGuardResult>;
  release(lease: GuardLease): Promise<{ released: boolean }>;
};

export type SessionMutationResult = { ok: true; headers: Headers } | MfaFailure;

export type AuditInput = {
  userId: string;
  ip: string | null;
  userAgent: string;
};

export type ActivateDependencies = {
  revokeOtherSessions(headers: Headers): Promise<SessionMutationResult>;
  activateTotp(headers: Headers, code: string): Promise<SessionMutationResult>;
  writeAudit(input: AuditInput): Promise<void>;
  // Observer は例外を投げず、確定済みの登録遷移を変更しない。
  observeAuditError(error: unknown): void;
};

export type DisableDependencies = {
  spendAttempt(userId: string): Promise<MfaFailure | undefined>;
  verifyCode(
    headers: Headers,
    input: { code: string; kind: MfaCodeKind },
  ): Promise<SessionMutationResult>;
  resetAttempts(userId: string): Promise<void>;
  revokeOtherSessions(headers: Headers): Promise<SessionMutationResult>;
  disableTotp(headers: Headers): Promise<SessionMutationResult>;
  writeAudit(input: AuditInput): Promise<void>;
  // Observer は例外を投げず、確定済みの登録遷移を変更しない。
  observeAuditError(error: unknown): void;
};

export type RegistrationOperations = {
  getStatus(principal: RegistrationPrincipal): Promise<MfaStatus>;
  enroll(input: {
    principal: RegistrationPrincipal;
    headers: Headers;
    snapshot: RegistrationSnapshot;
  }): Promise<EnrollResult>;
  restart(input: {
    principal: RegistrationPrincipal;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    enrollmentId: string;
  }): Promise<RestartResult>;
  activate(input: {
    principal: RegistrationPrincipal;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    enrollmentId?: string;
    code: string;
  }): Promise<{ ok: true; sessionChanges: Headers; notifyEmail: string } | MfaFailure>;
  disable(input: {
    principal: RegistrationPrincipal;
    headers: Headers;
    snapshot: RegistrationSnapshot;
    code: string;
    kind: MfaCodeKind;
  }): Promise<{ ok: true; sessionChanges: Headers; notifyEmail: string } | MfaFailure>;
};
