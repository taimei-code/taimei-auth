import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { findUserById } from "@/db/repositories/user";
import {
  countTwoFactorRows,
  enableMfaFor,
  wrongTotpCode,
  totpCode,
} from "../../mfa/__tests__/helpers";
import { createRateLimitMiddleware, mfaAttemptKey } from "../../rate-limit";
import { getClientContext } from "../../request-context";
import { accountMfa } from "../account-mfa";
import { createSeedHelpers } from "./helpers";

// account MFA API (src/handlers/account-mfa.ts) の統合テスト。
// 対象ユーザーは requireActor が解決した 1 人だけで、body の内容では動かない — セッションを
// 持つ誰もが他人の第二要素を外せる状態にしないための境界がここ。

const P = "mfa-h-account-";
const { cleanup, seedUser } = createSeedHelpers(P);

// src/app.ts の production 値と同値。local は 1000 に緩和されるため、実 app では枠の境界を
// 観測できない (緩和は開発体験のためで、枠の設計値ではない)。
const MFA_ATTEMPT_LIMIT = 10;

const buildApp = (): Hono => {
  const app = new Hono();
  app.use(
    "/api/account/mfa/disable",
    createRateLimitMiddleware({
      keyFn: (c) => mfaAttemptKey(c.req.raw.headers, getClientContext(c.req.raw.headers).ip),
      limit: MFA_ATTEMPT_LIMIT,
      windowSec: 60,
    }),
  );
  app.route("/", accountMfa);
  return app;
};

const postDisable = async (app: Hono, headers: Headers, body: unknown): Promise<Response> =>
  app.request("/api/account/mfa/disable", {
    method: "POST",
    headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("account MFA API", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-D-02 他人 userId 送っても本人のみ", async () => {
    const actorUser = await seedUser("d02-actor");
    const victimUser = await seedUser("d02-victim");
    const actor = await enableMfaFor(actorUser);
    const victim = await enableMfaFor(victimUser);

    const res = await postDisable(buildApp(), actor.session.headers, {
      code: await totpCode(actor.secret),
      kind: "totp",
      userId: victimUser.id,
      user_id: victimUser.id,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await countTwoFactorRows(actorUser.id)).toBe(0);
    expect((await findUserById(actorUser.id))?.twoFactorEnabled).toBe(false);
    // 被害者側は 1 bit も動かない。
    expect(await countTwoFactorRows(victimUser.id)).toBe(1);
    expect((await findUserById(victimUser.id))?.twoFactorEnabled).toBe(true);
    expect(victim.actor.twoFactorEnabled).toBe(true);
  });

  test("QA-M-09 disable 連投 → 429", async () => {
    const user = await seedUser("m09");
    const enabled = await enableMfaFor(user);
    const app = buildApp();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < MFA_ATTEMPT_LIMIT + 1; attempt++) {
      const res = await postDisable(app, enabled.session.headers, {
        code: await wrongTotpCode(enabled.secret),
        kind: "totp",
      });
      statuses.push(res.status);
    }

    // セッションあり経路にはプラグインの試行制限が継承されないため、誤コード連投を止めるのは
    // この rate limit だけ。枠を使い切るまでは 400 で、超えた分が 429 になる。
    expect(statuses.slice(0, MFA_ATTEMPT_LIMIT)).toEqual(
      Array(MFA_ATTEMPT_LIMIT).fill(400) as number[],
    );
    expect(statuses.at(-1)).toBe(429);

    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
  });

  test("GET /api/account/mfa は有効状態とリカバリーコード残数だけを返す", async () => {
    const user = await seedUser("status");
    const enabled = await enableMfaFor(user);

    const res = await buildApp().request("/api/account/mfa", { headers: enabled.session.headers });

    expect(res.status).toBe(200);
    // secret とリカバリーコードの実体を後から読み戻せる経路を作らないための response 形。
    expect(await res.json()).toEqual({
      enabled: true,
      recovery_codes_remaining: enabled.recoveryCodes.length,
    });
  });
});
