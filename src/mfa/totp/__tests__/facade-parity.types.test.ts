import { expect, test } from "bun:test";
import type { Effect } from "effect";
import type { Actor } from "../../../membership/guard/core";
import type {
  MfaChallengeStateResponse,
  MfaChallengeVerifyResponse,
  MfaEnrollResponse,
  MfaErrorResponse,
  MfaOkResponse,
  MfaStatusResponse,
  MfaClientFacingErrorCode,
} from "../../client-facing-contracts";
import type { MfaTotpActor } from "../contracts";

type Facade = typeof import("../index");

const _actorCompat: (actor: Actor) => MfaTotpActor = (actor) => actor;

type EnrollOk = Effect.Success<ReturnType<Facade["enroll"]>>;
const _enrollWire = (r: EnrollOk): MfaEnrollResponse => ({
  totp_uri: r.totpUri,
  recovery_codes: r.recoveryCodes,
  enrollment_id: r.enrollmentId,
});

type StatusResult = Effect.Success<ReturnType<Facade["readOwnedMfaStatus"]>>;
const _statusWire = (r: StatusResult): MfaStatusResponse => ({
  enabled: r.enabled,
  recovery_codes_remaining: r.recoveryCodesRemaining,
});

type ActivateOk = Effect.Success<ReturnType<Facade["activate"]>>;
type DisableOk = Effect.Success<ReturnType<Facade["disable"]>>;
const _activateForward = (r: ActivateOk): Headers => r.sessionChanges;
const _disableForward = (r: DisableOk): Headers => r.sessionChanges;
const _okBody: MfaOkResponse = { ok: true };

type ActivateFailure = Extract<
  Effect.Error<ReturnType<Facade["activate"]>>,
  { error: MfaClientFacingErrorCode }
>;
const _failureWire = (r: ActivateFailure): MfaErrorResponse => ({ error: r.error });
const _failureStatus = (r: ActivateFailure): number => r.status;

type ChallengeState = Effect.Success<ReturnType<Facade["readLoginChallengeState"]>>;
const _challengeStateWire = (r: ChallengeState): MfaChallengeStateResponse => r;

type CompletionOk = Effect.Success<ReturnType<Facade["completeLoginChallenge"]>>;
const _completionWire = (r: CompletionOk): MfaChallengeVerifyResponse => ({
  redirect_url: r.redirectUrl,
});
const _completionForward = (r: CompletionOk): Headers => r.forwardedHeaders;

test("契約検出器は typecheck で機能する (runtime 検証なし)", () => {
  expect(true).toBe(true);
});
