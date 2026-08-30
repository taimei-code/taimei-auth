import type { MfaFailure } from "../error-mapping";

// totp モジュールの公開結果型 (A-5)。guard の Actor がそのまま代入できる形に保つ。

export type MfaTotpActor = { id: string; email: string };

export type TotpEnrollmentMaterial = {
  enrollmentId: string;
  totpUri: string;
  recoveryCodes: string[];
};

export type TotpEnrollResult = ({ ok: true } & TotpEnrollmentMaterial) | MfaFailure;

export type TotpSessionResult = { ok: true; sessionChanges: Headers } | MfaFailure;

// wire の in_effect は enabled との恒等 — 写像は handler の 1 行に閉じる (ADR-0016 §3.1)。
export type TotpStatus = { enabled: boolean; recoveryCodesRemaining: number };
