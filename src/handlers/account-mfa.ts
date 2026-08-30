import { type Context, Hono } from "hono";
import { z } from "zod";

import { guardErrorResponse, requireActor, resolveParseBody } from "../membership/guard";
import type { MfaFailure } from "../mfa/error-mapping";
import { activate, disable, enroll, getStatus } from "../mfa/totp";
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

// SPA から呼ばれる MFA 登録遷移の 4 route。不変条件・順序・audit は use-case (src/mfa/totp/) 所有。
// 詳細: ADR-0016
export const accountMfa = new Hono();

const activateBody = z.object({ code: mfaCodeSchema, enrollment_id: z.string().min(1) });
const disableBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });
// 検出器: schema と wire 型の乖離を typecheck で落とす (MatchesWireShape のコメント参照)。
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
    // in_effect は enabled との恒等 (旧 wire 互換 field)。恒等はこの 1 行に閉じる。
    in_effect: status.enabled,
    recovery_codes_remaining: status.recoveryCodesRemaining,
  } satisfies MfaStatusResponse);
});

// POST 認証アプリの登録開始。登録途中なら同じ情報を返し、有効化済みならuse-caseが拒否する。
accountMfa.post("/api/account/mfa/enroll", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const result = await enroll({ actor: actorResult.actor });
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

  const result = await activate({
    actor: actorResult.actor,
    headers: c.req.raw.headers,
    code: parsed.data.code,
    enrollmentId: parsed.data.enrollment_id,
  });
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
  return c.json({ error: failure.error } satisfies MfaErrorResponse, failure.status);
}
