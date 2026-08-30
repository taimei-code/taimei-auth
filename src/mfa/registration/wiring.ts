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
import {
  activateTotp,
  disableTotp,
  enrollTotp,
  readPendingTotpEnrollment,
  revokeOtherSessions,
  verifyMfaCode,
} from "../gateway";
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
import type { GuardedGatewayFactory, GuardedMfaGateway, RegistrationOperations } from "./ports";
import { restart } from "./restart";

// self-service と management の両経路で同じ配線を共有し、片方だけ差替えが漏れる drift を防ぐ。
export const registrationGuard = {
  acquire: acquireRegistrationGuard,
  release: releaseRegistrationGuard,
};

// 遷移内窓口の唯一の束縛点 (正本: ADR-0013 §8)。hold は資格の証憑であって束縛材料ではないため
// module 定数を返すだけ。export は production-harness 用。
const guardedMfaGateway: GuardedMfaGateway = {
  enrollTotp,
  readPendingTotpEnrollment,
  verifyCode: verifyMfaCode,
  activateTotp,
  disableTotp,
  revokeOtherSessions,
};
export const guardedGateway: GuardedGatewayFactory = (_hold) => guardedMfaGateway;

export const managementApplication = createManagementApplication({
  guard: registrationGuard,
  reportUnknownTransition: reportUnknownMfaRegistrationTransition,
  guardedGateway,
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
    writeAudit: ({ userId, ip, userAgent }) => recordMfaEnabled({ user_id: userId, ip, userAgent }),
    observeAuditError: (error) => captureAuditLogError("mfa_enabled", error),
  }),
  disable: createDisable({
    spendAttempt: spendDisableAttempt,
    resetAttempts: resetDisableAttempts,
    writeAudit: ({ userId, ip, userAgent }) =>
      recordMfaDisabled({ user_id: userId, ip, userAgent }),
    observeAuditError: (error) => captureAuditLogError("mfa_disabled", error),
  }),
};

export const registrationApplication = createRegistrationApplication({
  guard: registrationGuard,
  reportUnknownTransition: reportUnknownMfaRegistrationTransition,
  guardedGateway,
  notifyEnabled: notifyMfaEnabled,
  notifyDisabled: notifyMfaDisabled,
  operations: productionRegistrationOperations,
});
