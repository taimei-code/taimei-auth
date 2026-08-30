import type { MfaFailure } from "../error-mapping";
import type { MfaKeyRing } from "./cipher";

// use-case が受け取る依存の型 (A-6)。結線は wiring.ts のみが行う。

export type SessionMutationResult = { ok: true; headers: Headers } | MfaFailure;

// port 名を revokeOthers にするのは gateway 名 (revokeOtherSessions) の出現を wiring に閉じるため。
export type SessionControl = { revokeOthers(headers: Headers): Promise<SessionMutationResult> };

export type AuditInput = { userId: string; ip: string | null; userAgent: string };

// env 読みを import 時に走らせない遅延解決 (kill-switch と同じ方針)。
export type KeyRingSource = () => MfaKeyRing;

export type EnrollMfaDependencies = { ring: KeyRingSource; issuer(): string };

export type ActivateMfaDependencies = {
  ring: KeyRingSource;
  sessions: SessionControl;
  writeAudit(input: AuditInput): Promise<void>;
  observeAuditError(error: unknown): void;
  // adapter は投げない契約 (notification-adapter が catch を内蔵する)。
  notifyEnabled(email: string): void;
};

export type DisableMfaDependencies = Omit<ActivateMfaDependencies, "notifyEnabled"> & {
  notifyDisabled(email: string): void;
  spendAttempt(userId: string): Promise<MfaFailure | undefined>;
  resetAttempts(userId: string): Promise<void>;
};
