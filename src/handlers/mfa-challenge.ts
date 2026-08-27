import { Hono } from "hono";
import { z } from "zod";

import { guardErrorResponse, resolveParseBody } from "../membership/guard";
import { readChallenge } from "../mfa/challenge-store";
import { completeChallenge } from "../mfa/complete-challenge";
import type {
  MatchesWireShape,
  MfaChallengeStateResponse,
  MfaChallengeVerifyRequest,
  MfaChallengeVerifyResponse,
  MfaErrorResponse,
} from "../mfa/wire-contracts";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";

// ログイン時 MFA チャレンジの通過 API。requireActor を通らず two_factor cookie を認証材料にする
// 二本目の認証経路のため、account-mfa.ts (セッションあり) とはファイルを分けて混線を防ぐ。
// 登録も mountAccountRoutes でなく個別 app.route (canary-token / login-shortcut と同じ扱い)。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const mfaChallenge = new Hono();

const verifyBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });
// 検出器: schema と wire 型の乖離を typecheck で落とす (MatchesWireShape のコメント参照)。
const _verifyBodyMatchesWire: MatchesWireShape<
  z.infer<typeof verifyBody>,
  MfaChallengeVerifyRequest
> = true;

// GET チャレンジの保留判定。返すのは boolean 1 つに限る — 遷移先・userId・第二要素の種別は
// いずれも cookie を拾った第三者への手掛かりになる。
mfaChallenge.get("/api/mfa/challenge", async (c) => {
  const challenge = await readChallenge(c.req.raw.headers);
  return c.json({ pending: challenge.pending } satisfies MfaChallengeStateResponse);
});

// POST チャレンジ通過 (検証・遷移先の出口検証・状態の掃除は completeChallenge が所有)。
mfaChallenge.post("/api/mfa/challenge/verify", async (c) => {
  const parsed = await resolveParseBody(parseZodBody(c, verifyBody));
  if (!parsed.ok) return guardErrorResponse(parsed);

  const result = await completeChallenge(c.req.raw.headers, parsed.data);
  if (!result.ok) return c.json({ error: result.error } satisfies MfaErrorResponse, result.status);

  return forwardSetCookie(
    c.json({ redirect_url: result.redirectUrl } satisfies MfaChallengeVerifyResponse),
    result.forwardedHeaders,
  );
});
