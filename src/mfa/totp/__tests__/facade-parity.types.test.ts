import { expect, test } from "bun:test";
import type { Effect } from "effect";
import type { Actor } from "../../../membership/guard/core";
import type { MfaClientFacingErrorCode } from "../../client-facing-contracts";
import type { ChallengePassed, ChallengeState as ChallengeStateWire } from "../../mfa-contract";
import type { MfaTotpActor } from "../contracts";

type Facade = typeof import("../index");

const _actorCompat: (actor: Actor) => MfaTotpActor = (actor) => actor;

type ActivateOk = Effect.Success<ReturnType<Facade["activate"]>>;
type DisableOk = Effect.Success<ReturnType<Facade["disable"]>>;
const _activateForward = (r: ActivateOk): Headers => r.sessionChanges;
const _disableForward = (r: DisableOk): Headers => r.sessionChanges;

type ActivateFailure = Extract<
  Effect.Error<ReturnType<Facade["activate"]>>,
  { error: MfaClientFacingErrorCode }
>;
const _failureWire = (r: ActivateFailure): { error: MfaClientFacingErrorCode } => ({
  error: r.error,
});
const _failureStatus = (r: ActivateFailure): number => r.status;

type ChallengeState = Effect.Success<ReturnType<Facade["readLoginChallengeState"]>>;
const _challengeStateWire = (r: ChallengeState): typeof ChallengeStateWire.Type => r;

type CompletionOk = Effect.Success<ReturnType<Facade["completeLoginChallenge"]>>;
const _completionWire = (r: CompletionOk): typeof ChallengePassed.Type => ({
  redirect_url: r.redirectUrl,
});
const _completionForward = (r: CompletionOk): Headers => r.forwardedHeaders;

test("契約検出器は typecheck で機能する (runtime 検証なし)", () => {
  expect(true).toBe(true);
});
