import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { requireActor } from "../membership/guard";
import { activate, disable, enroll, readOwnedMfaStatus } from "../mfa/totp";
import type {
  MatchesClientFacingShape,
  MfaActivateRequest,
  MfaDisableRequest,
  MfaEnrollResponse,
  MfaOkResponse,
  MfaStatusResponse,
} from "../mfa/client-facing-contracts";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";
import { runRoute } from "./run-route";

export const accountMfa = new Hono();

const activateBody = z.object({ code: mfaCodeSchema, enrollment_id: z.string().min(1) });
const disableBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });
const _activateBodyMatchesWire: MatchesClientFacingShape<
  z.infer<typeof activateBody>,
  MfaActivateRequest
> = true;
const _disableBodyMatchesWire: MatchesClientFacingShape<
  z.infer<typeof disableBody>,
  MfaDisableRequest
> = true;

accountMfa.get("/api/account/mfa", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const status = yield* readOwnedMfaStatus(actor);
      return c.json({
        enabled: status.enabled,
        in_effect: status.enabled,
        recovery_codes_remaining: status.recoveryCodesRemaining,
      } satisfies MfaStatusResponse);
    }),
  ),
);

accountMfa.post("/api/account/mfa/enroll", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const result = yield* enroll({ actor });
      return c.json({
        totp_uri: result.totpUri,
        recovery_codes: result.recoveryCodes,
        enrollment_id: result.enrollmentId,
      } satisfies MfaEnrollResponse);
    }),
  ),
);

accountMfa.post("/api/account/mfa/activate", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const input = yield* parseZodBody(c, activateBody);
      const result = yield* activate({
        actor,
        headers: c.req.raw.headers,
        code: input.code,
        enrollmentId: input.enrollment_id,
      });
      return forwardSetCookie(c.json({ ok: true } satisfies MfaOkResponse), result.sessionChanges);
    }),
  ),
);

accountMfa.post("/api/account/mfa/disable", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const input = yield* parseZodBody(c, disableBody);
      const result = yield* disable({
        actor,
        headers: c.req.raw.headers,
        code: input.code,
        kind: input.kind,
      });
      return forwardSetCookie(c.json({ ok: true } satisfies MfaOkResponse), result.sessionChanges);
    }),
  ),
);
