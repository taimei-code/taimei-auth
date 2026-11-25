import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Authenticated, type CurrentSession } from "../account/actor-contract";
import { Reauthenticated } from "../account/reauthentication-contract";
import { RateLimited } from "../failures";
import { Ok, SignedIn } from "../spa-contract-schemas";
import {
  AlreadyEnabled,
  ChallengeExpired,
  EnrollmentChanged,
  InvalidCode,
  Locked,
  MfaNotFound,
  NotEnabled,
} from "./errors";

const MfaCode = Schema.String.check(Schema.isBetweenLength(1, 64));
const CodeKind = Schema.Literals(["totp", "recovery_code"]);
export type MfaCodeKind = typeof CodeKind.Type;

export const MfaStatus = Schema.Struct({
  enabled: Schema.Boolean,
  recovery_codes_remaining: Schema.Finite,
});

export const MfaEnrollment = Schema.Struct({
  totp_uri: Schema.String.check(Schema.isMinLength(1)),
  recovery_codes: Schema.mutable(Schema.Array(Schema.String)).check(Schema.isMinLength(1)),
  enrollment_id: Schema.String.check(Schema.isMinLength(1)),
});

const ActivateRequest = Schema.Struct({
  code: MfaCode,
  enrollment_id: Schema.String.check(Schema.isMinLength(1)),
});
const CodeWithKind = Schema.Struct({ code: MfaCode, kind: CodeKind });
const ChallengeState = Schema.Struct({ pending: Schema.Boolean });

export class ChallengeVerifyBudget extends HttpApiMiddleware.Service<ChallengeVerifyBudget>()(
  "taimei/ChallengeVerifyBudget",
  { error: RateLimited },
) {}

export class ChallengeStateBudget extends HttpApiMiddleware.Service<ChallengeStateBudget>()(
  "taimei/ChallengeStateBudget",
  { error: RateLimited },
) {}

export class MfaChangeBudget extends HttpApiMiddleware.Service<
  MfaChangeBudget,
  { requires: CurrentSession }
>()("taimei/MfaChangeBudget", { error: RateLimited }) {}

export class MfaGroup extends HttpApiGroup.make("mfa")
  .add(
    HttpApiEndpoint.get("status", "/api/account/mfa", { success: MfaStatus }),
    HttpApiEndpoint.post("enroll", "/api/account/mfa/enroll", {
      success: MfaEnrollment,
      error: [AlreadyEnabled, ChallengeExpired],
    })
      .middleware(Reauthenticated)
      .middleware(MfaChangeBudget),
    HttpApiEndpoint.post("activate", "/api/account/mfa/activate", {
      payload: ActivateRequest,
      success: Ok,
      error: [InvalidCode, Locked, EnrollmentChanged, AlreadyEnabled, MfaNotFound],
    })
      .middleware(Reauthenticated)
      .middleware(MfaChangeBudget),
    HttpApiEndpoint.post("disable", "/api/account/mfa/disable", {
      payload: CodeWithKind,
      success: Ok,
      error: [InvalidCode, Locked, NotEnabled],
    }).middleware(MfaChangeBudget),
  )
  .middleware(Authenticated) {}

export class MfaChallengeGroup extends HttpApiGroup.make("mfaChallenge").add(
  HttpApiEndpoint.get("state", "/api/mfa/challenge", { success: ChallengeState }).middleware(
    ChallengeStateBudget,
  ),
  HttpApiEndpoint.post("verify", "/api/mfa/challenge/verify", {
    payload: CodeWithKind,
    success: SignedIn,
    error: [InvalidCode, Locked, ChallengeExpired],
  }).middleware(ChallengeVerifyBudget),
) {}
