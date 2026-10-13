import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { RateLimited } from "../membership/guard/errors";
import { Ok } from "../spa-contract-schemas";
import {
  AlreadyEnabled,
  ChallengeExpired,
  EnrollmentChanged,
  InvalidCode,
  Locked,
  MfaNotFound,
  NotEnabled,
} from "./errors";

const Code = Schema.String.check(Schema.isBetweenLength(1, 64));
const CodeKind = Schema.Literals(["totp", "recovery_code"]);
export type MfaCodeKind = typeof CodeKind.Type;

export const MfaStatus = Schema.Struct({
  enabled: Schema.Boolean,
  recovery_codes_remaining: Schema.Finite,
});
export type MfaStatus = typeof MfaStatus.Type;

export const MfaEnrollment = Schema.Struct({
  totp_uri: Schema.String.check(Schema.isMinLength(1)),
  recovery_codes: Schema.mutable(Schema.Array(Schema.String)).check(Schema.isMinLength(1)),
  enrollment_id: Schema.String.check(Schema.isMinLength(1)),
});
export type MfaEnrollment = typeof MfaEnrollment.Type;

const ActivateRequest = Schema.Struct({
  code: Code,
  enrollment_id: Schema.String.check(Schema.isMinLength(1)),
});
const CodeWithKind = Schema.Struct({ code: Code, kind: CodeKind });
const ChallengeState = Schema.Struct({ pending: Schema.Boolean });
export const ChallengePassed = Schema.Struct({
  redirect_url: Schema.String.check(Schema.isMinLength(1)),
});

export class ChallengeVerifyBudget extends HttpApiMiddleware.Service<ChallengeVerifyBudget>()(
  "taimei/ChallengeVerifyBudget",
  { error: RateLimited },
) {}

export class ChallengeStateBudget extends HttpApiMiddleware.Service<ChallengeStateBudget>()(
  "taimei/ChallengeStateBudget",
  { error: RateLimited },
) {}

export class MfaChangeBudget extends HttpApiMiddleware.Service<MfaChangeBudget>()(
  "taimei/MfaChangeBudget",
  { error: RateLimited },
) {}

export class MfaGroup extends HttpApiGroup.make("mfa")
  .add(
    HttpApiEndpoint.get("status", "/api/account/mfa", { success: MfaStatus }),
    HttpApiEndpoint.post("enroll", "/api/account/mfa/enroll", {
      success: MfaEnrollment,
      error: [AlreadyEnabled, ChallengeExpired],
    }).middleware(MfaChangeBudget),
    HttpApiEndpoint.post("activate", "/api/account/mfa/activate", {
      payload: ActivateRequest,
      success: Ok,
      error: [InvalidCode, Locked, EnrollmentChanged, AlreadyEnabled, MfaNotFound],
    }).middleware(MfaChangeBudget),
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
    success: ChallengePassed,
    error: [InvalidCode, Locked, ChallengeExpired],
  }).middleware(ChallengeVerifyBudget),
) {}
