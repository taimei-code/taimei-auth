import { Cause, Exit, Option } from "effect";
import { HttpClientError } from "effect/http";

import type { MfaClientFacingErrorCode } from "@core/mfa/client-facing-contracts";

import { SpaApiClient } from "../shared/spa-api-client";
import type { MfaChallengeObservation } from "./mfa-challenge-flow";

export type { MfaCodeKind } from "@core/mfa/client-facing-contracts";

export type MfaErrorCode = MfaClientFacingErrorCode | "rate_limited" | "unknown";

export const mfaStatusAtom = SpaApiClient.query("mfa", "status", {});
export const enrollMfaAtom = SpaApiClient.mutation("mfa", "enroll");
export const activateMfaAtom = SpaApiClient.mutation("mfa", "activate");
export const disableMfaAtom = SpaApiClient.mutation("mfa", "disable");

export const mfaChallengeStateAtom = SpaApiClient.query("mfaChallenge", "state", {});
export const verifyMfaChallengeAtom = SpaApiClient.mutation("mfaChallenge", "verify");

// Hono の rate limit の 429 と、server の契約の decode に落ちた body 無しの 400 は、契約に無い応答なので HttpClientError の defect になる
const CODE_BY_UNDECLARED_STATUS: ReadonlyMap<number | undefined, MfaErrorCode> = new Map([
  [400, "invalid_argument"],
  [429, "rate_limited"],
]);

const codeOfUndeclaredStatus = (defect: unknown): MfaErrorCode =>
  (HttpClientError.isHttpClientError(defect)
    ? CODE_BY_UNDECLARED_STATUS.get(defect.response?.status)
    : undefined) ?? "unknown";

export const mfaErrorCodeOfCause = (
  cause: Cause.Cause<{ readonly error: MfaErrorCode }>,
): MfaErrorCode =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (failure) => failure.error,
    onNone: () => codeOfUndeclaredStatus(Cause.squash(cause)),
  });

export const mfaChallengeObservationOf = (
  state: Exit.Exit<{ readonly pending: boolean }, unknown>,
): MfaChallengeObservation =>
  Exit.match(state, {
    onSuccess: ({ pending }) => (pending ? { kind: "present" } : { kind: "absent" }),
    onFailure: () => ({ kind: "unavailable" }),
  });
