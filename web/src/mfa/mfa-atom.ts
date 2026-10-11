import { Cause, Option } from "effect";
import { HttpClientError } from "effect/http";

import { SpaApiClient } from "../shared/spa-api-client";
import type { MfaErrorCode } from "./mfa-api";

export const mfaStatusAtom = SpaApiClient.query("mfa", "status", {});
export const enrollMfaAtom = SpaApiClient.mutation("mfa", "enroll");
export const activateMfaAtom = SpaApiClient.mutation("mfa", "activate");
export const disableMfaAtom = SpaApiClient.mutation("mfa", "disable");

// Hono の rate limit の 429 は契約に無い応答なので、AtomHttpApi は HttpClientError の defect にする
const isRateLimited = (defect: unknown): boolean =>
  HttpClientError.isHttpClientError(defect) && defect.response?.status === 429;

export const mfaErrorCodeOfCause = (
  cause: Cause.Cause<{ readonly error: MfaErrorCode }>,
): MfaErrorCode =>
  Option.match(Cause.findErrorOption(cause), {
    onSome: (failure) => failure.error,
    onNone: () => (isRateLimited(Cause.squash(cause)) ? "rate_limited" : "unknown"),
  });
