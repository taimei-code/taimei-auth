import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { findUserById } from "@/db/repositories/user";
import {
  acquireRegistrationGuard,
  releaseRegistrationGuard,
} from "@/db/repositories/mfa-registration";
import {
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  wrongTotpCode,
  totpCode,
} from "../../mfa/__tests__/helpers";
import { clearTwoFactorEnabled } from "../../mfa/gateway";
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

// src/mfa/disable-attempt-budget.ts の MAX_ATTEMPTS と同値。環境で緩和されないアカウント単位の
// 上限で、session 軸の rate limit より先に効く。
const DISABLE_ATTEMPT_LIMIT = 5;

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

  test("QA-M-09 disable 誤コード連投 → アカウント単位でロックアウト", async () => {
    const user = await seedUser("m09");
    const enabled = await enableMfaFor(user);
    const app = buildApp();

    const attempts: { status: number; body: unknown }[] = [];
    for (let attempt = 0; attempt < DISABLE_ATTEMPT_LIMIT + 1; attempt++) {
      const res = await postDisable(app, enabled.session.headers, {
        code: await wrongTotpCode(enabled.secret),
        kind: "totp",
      });
      attempts.push({ status: res.status, body: await res.json() });
    }

    // 枠を使い切るまでは 400、超えた分は use-case のロックアウトで 429。session 軸の rate limit
    // (10/min) より先に効くのは、cookie を盗んだ攻撃者がセッションを取り直しても枠が戻らない
    // user 軸で数えているため。同じ 429 でも SPA は body の error で待ち時間を書き分けるので、
    // 枠の出どころまで固定する。
    expect(attempts.slice(0, DISABLE_ATTEMPT_LIMIT).map((attempt) => attempt.status)).toEqual(
      Array(DISABLE_ATTEMPT_LIMIT).fill(400) as number[],
    );
    expect(attempts.at(-1)).toEqual({ status: 429, body: { error: "locked" } });

    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
  });

  test("GET /api/account/mfa は有効状態・in_effect・リカバリーコード残数だけを返す", async () => {
    const user = await seedUser("status");
    const enabled = await enableMfaFor(user);

    const res = await buildApp().request("/api/account/mfa", { headers: enabled.session.headers });

    expect(res.status).toBe(200);
    // secret とリカバリーコードの実体を後から読み戻せる経路を作らないための response 形。
    expect(await res.json()).toEqual({
      enabled: true,
      in_effect: true,
      recovery_codes_remaining: enabled.recoveryCodes.length,
    });
  });

  test("QA-H-01 enroll の応答は登録情報とopaqueな登録識別子だけを返す", async () => {
    const user = await seedUser("m03");
    const session = await createSessionFor(user.id);

    const res = await buildApp().request("/api/account/mfa/enroll", {
      method: "POST",
      headers: Object.fromEntries(session.headers),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enrollment_id: string;
      totp_uri: string;
      recovery_codes: string[];
    };
    // secret 単体のキーを増やさない (実体は totp_uri のクエリにのみ載る)。
    expect(Object.keys(body).sort()).toEqual(["enrollment_id", "recovery_codes", "totp_uri"]);
    expect(body.enrollment_id.length).toBeGreaterThan(0);
    expect(new URL(body.totp_uri).searchParams.get("secret")).not.toBeNull();
    expect(Array.isArray(body.recovery_codes)).toBe(true);
  });

  test("QA-M-04 未登録ユーザーの GET /api/account/mfa も同じキー形 (enabled/in_effect false)", async () => {
    const user = await seedUser("m04");
    const session = await createSessionFor(user.id);

    const res = await buildApp().request("/api/account/mfa", { headers: session.headers });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enabled: false,
      in_effect: false,
      recovery_codes_remaining: 0,
    });
  });

  test("QA-M-25 「中断した無効化」は enabled:false だが in_effect:true (UI 袋小路を防ぐ)", async () => {
    const user = await seedUser("m25");
    const enabled = await enableMfaFor(user);
    // フラグ降ろしだけ済んで verified 行が残った中断状態を作る。
    await clearTwoFactorEnabled(user.id);

    const res = await buildApp().request("/api/account/mfa", { headers: enabled.session.headers });

    expect(res.status).toBe(200);
    // enabled=false なので無効バッジ、しかし in_effect=true で SPA は disable を出す
    // (enroll は 409 なので唯一の出口が disable)。
    expect(await res.json()).toEqual({
      enabled: false,
      in_effect: true,
      recovery_codes_remaining: 0,
    });
  });

  test("QA-E-01 有効ユーザーの enroll → 409 already_enabled", async () => {
    const user = await seedUser("e01");
    const enabled = await enableMfaFor(user);

    const res = await buildApp().request("/api/account/mfa/enroll", {
      method: "POST",
      headers: Object.fromEntries(enabled.session.headers),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_enabled" });
  });

  test("QA-E-04 有効ユーザーの activate 再実行 → 409 (正しいコードでも副作用なし)", async () => {
    const user = await seedUser("e04");
    const enabled = await enableMfaFor(user);

    const res = await buildApp().request("/api/account/mfa/activate", {
      method: "POST",
      headers: {
        ...Object.fromEntries(enabled.session.headers),
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: await totpCode(enabled.secret) }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_enabled" });
    // rotate が走っていないこと (走ると本人が今のデバイスからログアウトする)。
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("QA-M-06 未登録ユーザーの activate → 404 not_found", async () => {
    const user = await seedUser("m06");
    const session = await createSessionFor(user.id);

    const res = await buildApp().request("/api/account/mfa/activate", {
      method: "POST",
      headers: { ...Object.fromEntries(session.headers), "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("QA-E-02 activateの不正な登録識別子は400で副作用を起こさない", async () => {
    const user = await seedUser("invalid-enrollment-id");
    const session = await createSessionFor(user.id);

    const res = await buildApp().request("/api/account/mfa/activate", {
      method: "POST",
      headers: { ...Object.fromEntries(session.headers), "content-type": "application/json" },
      body: JSON.stringify({ code: "123456", enrollment_id: 42 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_argument" });
    expect(await countTwoFactorRows(user.id)).toBe(0);
  });

  test("QA-E-05 競合中の登録操作は503とRetry-Afterを返す", async () => {
    const user = await seedUser("busy");
    const session = await createSessionFor(user.id);
    const acquired = await acquireRegistrationGuard(user.id, "disable");
    expect(acquired.acquired).toBe(true);
    if (!acquired.acquired) return;

    try {
      const res = await buildApp().request("/api/account/mfa/enroll", {
        method: "POST",
        headers: Object.fromEntries(session.headers),
      });

      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("10");
      expect(await res.json()).toEqual({ error: "temporarily_unavailable" });
      expect(await countTwoFactorRows(user.id)).toBe(0);
    } finally {
      await releaseRegistrationGuard(acquired.lease);
    }
  });
});
