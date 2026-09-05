import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { completeLoginChallenge, readLoginChallengeState } from "../mfa/totp";
import type {
  MatchesWireShape,
  MfaChallengeStateResponse,
  MfaChallengeVerifyRequest,
  MfaChallengeVerifyResponse,
} from "../mfa/wire-contracts";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";
import { runRoute } from "./run-route";

// ログイン時 MFA チャレンジの通過 API。requireActor を通らず mfa_login_challenge cookie を認証材料に
// する二本目の経路のため account-mfa.ts と file を分ける。登録も個別 app.route で行う。詳細: ADR-0016
export const mfaChallenge = new Hono();

const verifyBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });
// 検出器: schema と wire 型の乖離を typecheck で落とす (MatchesWireShape のコメント参照)。
const _verifyBodyMatchesWire: MatchesWireShape<
  z.infer<typeof verifyBody>,
  MfaChallengeVerifyRequest
> = true;

// GET チャレンジの保留判定。返すのは boolean 1 つに限る — 他は cookie を拾った第三者への手掛かりになる。
// Redis (challenge cookie の状態) の障害は RedisError (boundary、Sentry warning) として 500 に落とす。
mfaChallenge.get("/api/mfa/challenge", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const state = yield* readLoginChallengeState(c.req.raw.headers);
      return c.json(state satisfies MfaChallengeStateResponse);
    }),
  ),
);

// POST チャレンジ通過 (検証・遷移先の出口検証・状態の掃除は completeLoginChallenge が所有)。
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
