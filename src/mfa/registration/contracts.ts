import type { Actor } from "../../membership/guard/core";
import type { MfaFailure } from "../error-mapping";

// MFA 操作が主体に要求する最小射影。use-case 層が所有し、gateway など外側の層はここから import する
// (ADR-0012 の層方向: 外側 → 内側)。membership guard の Actor は構造的部分型としてそのまま渡せる。
// string の userId を直接受けない形は viewBackupCodes 系を IDOR にしないため (型 tripwire: QA-M-14)。
export type MfaActor = Pick<Actor, "id" | "email" | "twoFactorEnabled">;

export type EnrollmentMaterial = {
  enrollmentId: string;
  totpUri: string;
  recoveryCodes: string[];
};

export type EnrollResult = ({ ok: true } & EnrollmentMaterial) | MfaFailure;
export type RestartResult = EnrollResult;
