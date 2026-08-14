import type { MfaFailure } from "../error-mapping";

export type RegistrationPrincipal = {
  userId: string;
  email: string;
  twoFactorEnabled: boolean;
};

export type EnrollmentMaterial = {
  enrollmentId: string;
  totpUri: string;
  recoveryCodes: string[];
};

export type EnrollResult = ({ ok: true } & EnrollmentMaterial) | MfaFailure;
export type RestartResult = EnrollResult;
