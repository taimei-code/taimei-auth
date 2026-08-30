import { type Context, Hono } from "hono";
import { z } from "zod";

import { guardErrorResponse, requireActor, resolveParseBody } from "../membership/guard";
import type { MfaFailure } from "../mfa/error-mapping";
import { activate, disable, enroll, getStatus } from "../mfa/registration";
import { activateLegacy } from "../mfa/registration/compatibility";
import type {
  MatchesWireShape,
  MfaActivateRequest,
  MfaDisableRequest,
  MfaEnrollResponse,
  MfaErrorResponse,
  MfaOkResponse,
  MfaStatusResponse,
} from "../mfa/wire-contracts";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";

// SPA から呼ばれる MFA 登録遷移の 4 route。プラグインの /two-factor/* は露出させずここだけを窓口にする
// (生 path は before-hook が 403)。不変条件・順序・audit は use-case (src/mfa/) 所有。詳細: ADR-0013
export const accountMfa = new Hono();

const activateBody = z.object({ code: mfaCodeSchema, enrollment_id: z.string().min(1).optional() });
const disableBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });
// 検出器: schema と wire 型の乖離 (optional 欠落 = 全 activate が legacy 経路へ落ちる) を typecheck で落とす。
const _activateBodyMatchesWire: MatchesWireShape<
  z.infer<typeof activateBody>,
  MfaActivateRequest
> = true;
const _disableBodyMatchesWire: MatchesWireShape<
  z.infer<typeof disableBody>,
  MfaDisableRequest
> = true;

// GET MFA 状態。secret とリカバリーコードの実体は載せず、登録途中の再表示はenrollだけに閉じる。
accountMfa.get("/api/account/mfa", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const status = await getStatus(actorResult.actor);
  return c.json({
    enabled: status.enabled,
    in_effect: status.inEffect,
    recovery_codes_remaining: status.recoveryCodesRemaining,
  } satisfies MfaStatusResponse);
});

// POST 認証アプリの登録開始。登録途中なら同じ情報を返し、有効化済みならuse-caseが拒否する。
accountMfa.post("/api/account/mfa/enroll", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const result = await enroll({
    actor: actorResult.actor,
    headers: c.req.raw.headers,
  });
  if (!result.ok) return mfaErrorResponse(c, result);
  return c.json({
    totp_uri: result.totpUri,
    recovery_codes: result.recoveryCodes,
    enrollment_id: result.enrollmentId,
  } satisfies MfaEnrollResponse);
});

// POST 有効化 (6 桁コードで verified 化)。
accountMfa.post("/api/account/mfa/activate", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const parsed = await resolveParseBody(parseZodBody(c, activateBody));
  if (!parsed.ok) return guardErrorResponse(parsed);

  const activation = {
    actor: actorResult.actor,
    headers: c.req.raw.headers,
    code: parsed.data.code,
  };
  // 判定は「フィールドの有無」で行う。truthiness だと空文字が識別子照合を素通りする legacy 経路に落ちる。
  const result =
    parsed.data.enrollment_id !== undefined
      ? await activate({ ...activation, enrollmentId: parsed.data.enrollment_id })
      : await activateLegacy(activation);
  if (!result.ok) return mfaErrorResponse(c, result);

  return forwardSetCookie(c.json({ ok: true } satisfies MfaOkResponse), result.sessionChanges);
});

// POST 無効化 (現在の TOTP コードまたはリカバリーコードによる本人確認つき)。
accountMfa.post("/api/account/mfa/disable", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const parsed = await resolveParseBody(parseZodBody(c, disableBody));
  if (!parsed.ok) return guardErrorResponse(parsed);

  const result = await disable({
    actor: actorResult.actor,
    headers: c.req.raw.headers,
    code: parsed.data.code,
    kind: parsed.data.kind,
  });
  if (!result.ok) return mfaErrorResponse(c, result);

  return forwardSetCookie(c.json({ ok: true } satisfies MfaOkResponse), result.sessionChanges);
});

function mfaErrorResponse(c: Context, failure: MfaFailure) {
  if (failure.error === "temporarily_unavailable") {
    c.header("Retry-After", String(failure.retryAfterSeconds));
  }
  return c.json({ error: failure.error } satisfies MfaErrorResponse, failure.status);
}
