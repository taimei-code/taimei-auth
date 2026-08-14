import { type Context, Hono } from "hono";
import { z } from "zod";

import { guardErrorResponse, requireActor, resolveParseBody } from "../membership/guard";
import type { MfaFailure } from "../mfa/error-mapping";
import { activate, disable, enroll, getStatus } from "../mfa/registration";
import { activateLegacy } from "../mfa/registration/compatibility";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";

// SPA のセキュリティページから呼ばれる MFA 登録遷移 (requireActor 経路)。プラグインの /two-factor/* は
// ブラウザに露出させずこの 4 route だけを窓口にする (生 path は auth-plugins/mfa-challenge.ts の
// before-hook が 403 に落とす)。不変条件・副作用順序・audit は use-case (src/mfa/) が所有する。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const accountMfa = new Hono();

const activateBody = z.object({ code: mfaCodeSchema, enrollment_id: z.string().min(1).optional() });
const disableBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });

// GET MFA 状態。secret とリカバリーコードの実体は載せず、登録途中の再表示はenrollだけに閉じる。
accountMfa.get("/api/account/mfa", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const status = await getStatus(principalOf(actorResult.actor));
  return c.json({
    enabled: status.enabled,
    in_effect: status.inEffect,
    recovery_codes_remaining: status.recoveryCodesRemaining,
  });
});

// POST 認証アプリの登録開始。登録途中なら同じ情報を返し、有効化済みならuse-caseが拒否する。
accountMfa.post("/api/account/mfa/enroll", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const result = await enroll({
    principal: principalOf(actorResult.actor),
    headers: c.req.raw.headers,
  });
  if (!result.ok) return mfaErrorResponse(c, result);
  return c.json({
    totp_uri: result.totpUri,
    recovery_codes: result.recoveryCodes,
    enrollment_id: result.enrollmentId,
  });
});

// POST 有効化 (6 桁コードで verified 化)。
accountMfa.post("/api/account/mfa/activate", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const parsed = await resolveParseBody(parseZodBody(c, activateBody));
  if (!parsed.ok) return guardErrorResponse(parsed);

  const activation = {
    principal: principalOf(actorResult.actor),
    headers: c.req.raw.headers,
    code: parsed.data.code,
  };
  // 判定は「フィールドの有無」で行う。truthiness だと空文字が schema の .min(1) 緩和 1 つで
  // 識別子照合を素通りする legacy 経路に落ちる (照合迂回の入口を .min(1) と二重に塞ぐ)。
  const result =
    parsed.data.enrollment_id !== undefined
      ? await activate({ ...activation, enrollmentId: parsed.data.enrollment_id })
      : await activateLegacy(activation);
  if (!result.ok) return mfaErrorResponse(c, result);

  return forwardSetCookie(c.json({ ok: true }), result.sessionChanges);
});

// POST 無効化 (現在の TOTP コードまたはリカバリーコードによる本人確認つき)。
accountMfa.post("/api/account/mfa/disable", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const parsed = await resolveParseBody(parseZodBody(c, disableBody));
  if (!parsed.ok) return guardErrorResponse(parsed);

  const result = await disable({
    principal: principalOf(actorResult.actor),
    headers: c.req.raw.headers,
    code: parsed.data.code,
    kind: parsed.data.kind,
  });
  if (!result.ok) return mfaErrorResponse(c, result);

  return forwardSetCookie(c.json({ ok: true }), result.sessionChanges);
});

function principalOf(actor: { id: string; email: string; twoFactorEnabled: boolean }) {
  return { userId: actor.id, email: actor.email, twoFactorEnabled: actor.twoFactorEnabled };
}

function mfaErrorResponse(c: Context, failure: MfaFailure & { retryAfterSeconds?: number }) {
  if (failure.retryAfterSeconds !== undefined) {
    c.header("Retry-After", String(failure.retryAfterSeconds));
  }
  return c.json({ error: failure.error }, failure.status);
}
