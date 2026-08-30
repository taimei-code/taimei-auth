import { registrationApplication } from "./wiring";

export type { MfaActor } from "./contracts";

// getStatus は guard に参加しないため、application を経由させず状態所有者へ直接 bind する (ADR-0013 §8)。
export { readStatus as getStatus } from "./status";
export const enroll = registrationApplication.enroll;
export const activate = registrationApplication.activate;
export const disable = registrationApplication.disable;
