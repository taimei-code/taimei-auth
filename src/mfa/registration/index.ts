import { registrationApplication } from "./wiring";

export type { RegistrationPrincipal } from "./contracts";
export type { TransitionBusy } from "./transition";

export const getStatus = registrationApplication.getStatus;
export const enroll = registrationApplication.enroll;
export const activate = registrationApplication.activate;
export const disable = registrationApplication.disable;
