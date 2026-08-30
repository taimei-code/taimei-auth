// totp モジュールの façade。handler はここだけを import する (containment が固定)。
export type { MfaTotpActor } from "./contracts";
export { readLoginChallengeState } from "./login-challenge";
export { readOwnedMfaStatus as getStatus } from "./read-status";
export {
  activateOperation as activate,
  completeLoginChallengeOperation,
  disableOperation as disable,
  enrollOperation as enroll,
} from "./wiring";
