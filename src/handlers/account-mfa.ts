import { Hono } from "hono";
import { z } from "zod";

import { runBackground } from "../background";
import { sendMfaDisabledEmail, sendMfaEnabledEmail } from "../email/send-mfa-notification";
import { guardErrorResponse, requireActor, resolveParseBody } from "../membership/guard";
import { activate } from "../mfa/activate";
import { disable } from "../mfa/disable";
import { enroll } from "../mfa/enroll";
import { readStatus } from "../mfa/read-status";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";

// SPA のセキュリティページから呼ばれる MFA 操作 (requireActor 経路)。プラグインの /two-factor/* は
// ブラウザに露出させずこの 4 route だけを窓口にする (生 path は auth-plugins/mfa-challenge.ts の
// before-hook が 403 に落とす)。不変条件・副作用順序・audit は use-case (src/mfa/) が所有する。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const accountMfa = new Hono();

const activateBody = z.object({ code: mfaCodeSchema });
const disableBody = z.object({ code: mfaCodeSchema, kind: mfaCodeKindSchema });

// GET MFA 状態。secret とリカバリーコードの実体は決して載せない — 一度きり表示したものを
// 後から読み戻せる経路を作らないための境界がこの response 形。
accountMfa.get("/api/account/mfa", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const status = await readStatus(actorResult.actor);
  return c.json({
    enabled: status.enabled,
    recovery_codes_remaining: status.recoveryCodesRemaining,
  });
});

// POST 認証アプリの登録開始。TOTP URI とリカバリーコードを本人に渡す唯一の機会で、再取得の経路は
// 持たない (有効化済みユーザーの再登録を 409 で拒む前提条件は enroll use-case が持つ)。
accountMfa.post("/api/account/mfa/enroll", async (c) => {
  const actorResult = await requireActor(c.req.raw.headers);
  if (!actorResult.ok) return guardErrorResponse(actorResult);

  const result = await enroll(actorResult.actor, c.req.raw.headers);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ totp_uri: result.totpUri, recovery_codes: result.recoveryCodes });
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
  });
  if (!result.ok) return c.json({ error: result.error }, result.status);

  notifyMfaChange(sendMfaEnabledEmail(result.notifyEmail));
  return forwardSetCookie(c.json({ ok: true }), result.forwardedHeaders);
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
  if (!result.ok) return c.json({ error: result.error }, result.status);

  notifyMfaChange(sendMfaDisabledEmail(result.notifyEmail));
  return forwardSetCookie(c.json({ ok: true }), result.forwardedHeaders);
});

// 状態変化が確定してから送る post-commit 分担は招待メールと同じ (src/handlers/account-invitation.ts)。
function notifyMfaChange(sending: Promise<void>): void {
  runBackground(
    sending.catch((e) => {
      console.error("failed to send MFA notification email", e);
    }),
  );
}
