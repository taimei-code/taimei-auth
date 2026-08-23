import {
  acquireRegistrationGuard,
  readRegistrationGuardProtocolVersion,
  releaseRegistrationGuard,
  releaseRegistrationGuardByManagement,
} from "@/db/repositories/mfa-registration";
import { findUserById } from "@/db/repositories/user";
import { recordMfaDisabled, recordMfaEnabled } from "@/db/repositories/audit-log";
import { captureAuditLogError } from "../../audit-error";
import { resetDisableAttempts, spendDisableAttempt } from "../disable-attempt-budget";
import { activateTotp, disableTotp, revokeOtherSessions, verifyMfaCode } from "../gateway";
import { createActivate } from "./activate";
import { createRegistrationApplication } from "./application";
import { createDisable } from "./disable";
import { enroll } from "./enroll";
import { forceDisableMfa } from "./force-disable";
import { createManagementApplication } from "./management";
import {
  notifyMfaDisabled,
  notifyMfaDisabledForManagement,
  notifyMfaEnabled,
} from "./notification-adapter";
import { reportUnknownMfaRegistrationTransition } from "./observability-adapter";
import type { RegistrationOperations } from "./ports";
import { restart } from "./restart";

// self-service と management の両経路が同じ production guard 配線を共有する (二重定義で
// 片方だけ計測やアダプタ差替えが漏れる drift を防ぐ)。
export const registrationGuard = {
  acquire: acquireRegistrationGuard,
  release: releaseRegistrationGuard,
};

export const managementApplication = createManagementApplication({
  guard: registrationGuard,
  reportUnknownTransition: reportUnknownMfaRegistrationTransition,
  readProtocolVersion: readRegistrationGuardProtocolVersion,
  findUserById,
  forceDisableOperation: forceDisableMfa,
  releaseGuardByManagement: releaseRegistrationGuardByManagement,
  notifyDisabled: notifyMfaDisabledForManagement,
});

export const productionRegistrationOperations: RegistrationOperations = {
  enroll,
  restart,
  activate: createActivate({
    revokeOtherSessions,
    activateTotp,
    writeAudit: ({ userId, ip, userAgent }) => recordMfaEnabled({ user_id: userId, ip, userAgent }),
    observeAuditError: (error) => captureAuditLogError("mfa_enabled", error),
  }),
  disable: createDisable({
    spendAttempt: spendDisableAttempt,
    verifyCode: verifyMfaCode,
    resetAttempts: resetDisableAttempts,
    revokeOtherSessions,
    disableTotp,
    writeAudit: ({ userId, ip, userAgent }) =>
      recordMfaDisabled({ user_id: userId, ip, userAgent }),
    observeAuditError: (error) => captureAuditLogError("mfa_disabled", error),
  }),
};

export const registrationApplication = createRegistrationApplication({
  guard: registrationGuard,
  reportUnknownTransition: reportUnknownMfaRegistrationTransition,
  notifyEnabled: notifyMfaEnabled,
  notifyDisabled: notifyMfaDisabled,
  operations: productionRegistrationOperations,
});
