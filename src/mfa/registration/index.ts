import { registrationApplication } from "./wiring";

export type { MfaActor } from "./contracts";
export type { TransitionBusy } from "./transition";

// getStatus は guard に参加しない (ADR-0013 §8) — application を経由させず状態所有者へ直接 bind し、
// 参加しないことを構造で表明する。
export { readStatus as getStatus } from "./status";
export const enroll = registrationApplication.enroll;
export const activate = registrationApplication.activate;
export const disable = registrationApplication.disable;
