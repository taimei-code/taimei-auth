import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { requireActor } from "../membership/guard";
import { activate, disable, enroll, readOwnedMfaStatus } from "../mfa/totp";
import type {
  MatchesWireShape,
  MfaActivateRequest,
  MfaDisableRequest,
  MfaEnrollResponse,
  MfaOkResponse,
  MfaStatusResponse,
} from "../mfa/wire-contracts";
import { forwardSetCookie } from "./forward-cookies";
import { mfaCodeKindSchema, mfaCodeSchema, parseZodBody } from "./parse-body";
import { runRoute } from "./run-route";

// SPA から呼ばれる MFA 登録遷移の 4 route。不変条件・順序・audit は use-case (src/mfa/totp/) 所有。
// MFA の失敗は failure class (src/mfa/error-mapping.ts) として E channel に載り、guard の failure と
// 同じ 1 経路 (runRoute) で wire に写像される。詳細: ADR-0016 / ADR-0017
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
accountMfa.get("/api/account/mfa", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const status = yield* readOwnedMfaStatus(actor);
      return c.json({
        enabled: status.enabled,
        // in_effect は enabled との恒等 (旧 wire 互換 field)。恒等はこの 1 行に閉じる。
        in_effect: status.enabled,
        recovery_codes_remaining: status.recoveryCodesRemaining,
      } satisfies MfaStatusResponse);
    }),
  ),
);

// POST 認証アプリの登録開始。登録途中なら同じ情報を返し、有効化済みならuse-caseが拒否する。
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

// POST 有効化 (6 桁コードで verified 化)。
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

// POST 無効化 (現在の TOTP コードまたはリカバリーコードによる本人確認つき)。
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
