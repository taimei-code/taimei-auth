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
