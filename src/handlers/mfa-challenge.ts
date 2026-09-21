import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { completeLoginChallenge, readLoginChallengeState } from "../mfa/totp";
import type {
  MatchesClientFacingShape,
  MfaChallengeStateResponse,
  MfaChallengeVerifyRequest,
  MfaChallengeVerifyResponse,
} from "../mfa/client-facing-contracts";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";
import { runRoute } from "./run-route";

export const mfaChallenge = new Hono();

const verifyBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });
const _verifyBodyMatchesWire: MatchesClientFacingShape<
  z.infer<typeof verifyBody>,
  MfaChallengeVerifyRequest
> = true;

// 返すのは boolean 1 つに限る。他は cookie を拾った第三者への手掛かりになる。
mfaChallenge.get("/api/mfa/challenge", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const state = yield* readLoginChallengeState(c.req.raw.headers);
      return c.json(state satisfies MfaChallengeStateResponse);
    }),
  ),
);

mfaChallenge.post("/api/mfa/challenge/verify", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const input = yield* parseZodBody(c, verifyBody);
      const result = yield* completeLoginChallenge(c.req.raw.headers, input);
      return forwardSetCookie(
        c.json({ redirect_url: result.redirectUrl } satisfies MfaChallengeVerifyResponse),
        result.forwardedHeaders,
      );
    }),
  ),
);
