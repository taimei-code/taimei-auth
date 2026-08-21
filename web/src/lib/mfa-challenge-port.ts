import type { MfaChallengePort } from "./mfa-challenge-flow";
import {
  getMfaChallenge,
  MfaApiError,
  type MfaChallengePassed,
  type MfaChallengeState,
  type MfaCodeKind,
  type MfaErrorCode,
  verifyMfaChallenge,
} from "./mfa-api";

export type MfaChallengeCodeInput = { code: string; kind: MfaCodeKind };

export type MfaChallengeApi = {
  getChallenge(signal?: AbortSignal): Promise<MfaChallengeState>;
  // POST 側には意図的に AbortSignal を渡さない。理由は ADR-0013 §9。
  verifyChallenge(input: MfaChallengeCodeInput): Promise<MfaChallengePassed>;
};

export function createMfaChallengePort(
  api: MfaChallengeApi,
): MfaChallengePort<MfaChallengeCodeInput, MfaErrorCode> {
  return {
    observe: async (signal) => {
      try {
        const { pending } = await api.getChallenge(signal);
        return pending ? { kind: "present" } : { kind: "absent" };
      } catch (error) {
        if (signal.aborted) throw error;
        return { kind: "unavailable" };
      }
    },
    verify: async (input) => {
      try {
        const { redirect_url } = await api.verifyChallenge(input);
        return { kind: "passed", redirectUrl: redirect_url };
      } catch (error) {
        return {
          kind: "rejected",
          errorCode: error instanceof MfaApiError ? error.code : "unknown",
        };
      }
    },
  };
}

export const mfaChallengePort = createMfaChallengePort({
  getChallenge: getMfaChallenge,
  verifyChallenge: verifyMfaChallenge,
});
