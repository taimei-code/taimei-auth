import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import {
  activate,
  completeLoginChallenge,
  disable,
  enroll,
  readLoginChallengeState,
  readOwnedMfaStatus,
} from "../mfa/totp";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary, forwardSetCookies, headersOf } from "./request-http-api";

export const MfaHandlers = HttpApiBuilder.group(SpaApi, "mfa", (handlers) =>
  handlers.handleAll({
    status: Effect.fnUntraced(function* () {
      const status = yield* readOwnedMfaStatus(yield* CurrentActor);
      return {
        enabled: status.enabled,
        recovery_codes_remaining: status.recoveryCodesRemaining,
      };
    }, dieOnBoundary),
    enroll: Effect.fnUntraced(function* () {
      const result = yield* enroll({ actor: yield* CurrentActor });
      return {
        totp_uri: result.totpUri,
        recovery_codes: result.recoveryCodes,
        enrollment_id: result.enrollmentId,
      };
    }, dieOnBoundary),
    activate: Effect.fnUntraced(function* ({ payload, request }) {
      const result = yield* activate({
        actor: yield* CurrentActor,
        headers: headersOf(request),
        code: payload.code,
        enrollmentId: payload.enrollment_id,
      });
      yield* forwardSetCookies(result.sessionChanges);
      return { ok: true as const };
    }, dieOnBoundary),
    disable: Effect.fnUntraced(function* ({ payload, request }) {
      const result = yield* disable({
        actor: yield* CurrentActor,
        headers: headersOf(request),
        code: payload.code,
        kind: payload.kind,
      });
      yield* forwardSetCookies(result.sessionChanges);
      return { ok: true as const };
    }, dieOnBoundary),
  }),
);

// boolean 1 つだけを返す。それ以外は cookie を入手した第三者への手掛かりになる。
export const MfaChallengeHandlers = HttpApiBuilder.group(SpaApi, "mfaChallenge", (handlers) =>
  handlers.handleAll({
    state: ({ request }) => readLoginChallengeState(headersOf(request)).pipe(dieOnBoundary),
    verify: Effect.fnUntraced(function* ({ payload, request }) {
      const result = yield* completeLoginChallenge(headersOf(request), payload);
      yield* forwardSetCookies(result.forwardedHeaders);
      return { redirect_url: result.redirectUrl };
    }, dieOnBoundary),
  }),
);
