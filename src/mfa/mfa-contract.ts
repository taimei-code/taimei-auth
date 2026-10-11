import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Authenticated } from "../account/actor-contract";
import { Ok } from "../membership/membership-contract";
import type {
  MatchesClientFacingShape,
  MfaActivateRequest,
  MfaChallengeStateResponse,
  MfaChallengeVerifyRequest,
  MfaChallengeVerifyResponse,
  MfaDisableRequest,
  MfaEnrollResponse,
  MfaOkResponse,
  MfaStatusResponse,
} from "./client-facing-contracts";
import {
  AlreadyEnabled,
  ChallengeExpired,
  EnrollmentChanged,
  InvalidCode,
  Locked,
  MfaNotFound,
  NotEnabled,
} from "./error-mapping";

const Code = Schema.String.check(Schema.isBetweenLength(1, 64));
const CodeKind = Schema.Literals(["totp", "recovery_code"]);

const MfaStatus = Schema.Struct({
  enabled: Schema.Boolean,
  recovery_codes_remaining: Schema.Number,
});
const MfaEnrollment = Schema.Struct({
  totp_uri: Schema.String,
  recovery_codes: Schema.mutable(Schema.Array(Schema.String)),
  enrollment_id: Schema.String,
});
const ActivateRequest = Schema.Struct({
  code: Code,
  enrollment_id: Schema.String.check(Schema.isMinLength(1)),
});
const CodeWithKind = Schema.Struct({ code: Code, kind: CodeKind });
const ChallengeState = Schema.Struct({ pending: Schema.Boolean });
const ChallengePassed = Schema.Struct({ redirect_url: Schema.String });

const _statusMatchesWire: MatchesClientFacingShape<
  typeof MfaStatus.Type,
  Readonly<MfaStatusResponse>
> = true;
const _enrollMatchesWire: MatchesClientFacingShape<
  typeof MfaEnrollment.Type,
  Readonly<MfaEnrollResponse>
> = true;
const _stateMatchesWire: MatchesClientFacingShape<
  typeof ChallengeState.Type,
  Readonly<MfaChallengeStateResponse>
> = true;
const _passedMatchesWire: MatchesClientFacingShape<
  typeof ChallengePassed.Type,
  Readonly<MfaChallengeVerifyResponse>
> = true;
const _okMatchesWire: MatchesClientFacingShape<typeof Ok.Type, Readonly<MfaOkResponse>> = true;
const _activateRequestMatchesWire: MatchesClientFacingShape<
  typeof ActivateRequest.Type,
  Readonly<MfaActivateRequest>
> = true;
const _disableRequestMatchesWire: MatchesClientFacingShape<
  typeof CodeWithKind.Type,
  Readonly<MfaDisableRequest>
> = true;
const _verifyRequestMatchesWire: MatchesClientFacingShape<
  typeof CodeWithKind.Type,
  Readonly<MfaChallengeVerifyRequest>
> = true;

export class MfaGroup extends HttpApiGroup.make("mfa")
  .add(
    HttpApiEndpoint.get("status", "/api/account/mfa", { success: MfaStatus }),
    HttpApiEndpoint.post("enroll", "/api/account/mfa/enroll", {
      success: MfaEnrollment,
      error: [AlreadyEnabled, ChallengeExpired],
    }),
    HttpApiEndpoint.post("activate", "/api/account/mfa/activate", {
      payload: ActivateRequest,
      success: Ok,
      error: [InvalidCode, Locked, EnrollmentChanged, AlreadyEnabled, MfaNotFound],
    }),
    HttpApiEndpoint.post("disable", "/api/account/mfa/disable", {
      payload: CodeWithKind,
      success: Ok,
      error: [InvalidCode, Locked, NotEnabled],
    }),
  )
  .middleware(Authenticated) {}

export class MfaChallengeGroup extends HttpApiGroup.make("mfaChallenge").add(
  HttpApiEndpoint.get("state", "/api/mfa/challenge", { success: ChallengeState }),
  HttpApiEndpoint.post("verify", "/api/mfa/challenge/verify", {
    payload: CodeWithKind,
    success: ChallengePassed,
    error: [InvalidCode, Locked, ChallengeExpired],
  }),
) {}
