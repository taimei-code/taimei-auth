import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  createSessionFor,
  enableMfaFor,
  findMfaTotpRow,
  totpCode,
  wrongTotpCode,
} from "../../mfa/__tests__/helpers";
import { createRateLimitMiddleware, mfaAttemptKey } from "../../rate-limit";
import { getClientContext } from "../../request-context";
import { accountMfa } from "../account-mfa";
import { createSeedHelpers } from "./helpers";

// account MFA API (src/handlers/account-mfa.ts) の統合テスト。
// 対象ユーザーは requireActor が解決した 1 人だけで、body の内容では動かない — セッションを
// 持つ誰もが他人の第二要素を外せる状態にしないための境界がここ。
// wire の期待 JSON は旧実装のテストから不変 (「wire 不変」の最終観測 — ADR-0016)。

const P = "mfa-h-account-";
const { cleanup, seedUser } = createSeedHelpers(P);

// src/app.ts の production 値と同値。local は 1000 に緩和されるため、実 app では枠の境界を
// 観測できない。
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

const postJson = async (
  app: Hono,
  path: string,
  headers: Headers,
  body: unknown,
): Promise<Response> =>
  app.request(path, {
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
    await enableMfaFor(victimUser);

    const res = await postJson(buildApp(), "/api/account/mfa/disable", actor.session.headers, {
      code: await totpCode(actor.secret),
      kind: "totp",
      userId: victimUser.id,
      user_id: victimUser.id,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await countMfaTotpRows(actorUser.id)).toBe(0);
    expect(await countRecoveryCodeRows(actorUser.id)).toBe(0);
    // 被害者側は 1 bit も動かない。
    expect(await countMfaTotpRows(victimUser.id)).toBe(1);
    expect((await findMfaTotpRow(victimUser.id))?.verifiedAt).not.toBeNull();
  });

  test("QA-M-09 disable 誤コード連投 → アカウント単位でロックアウト", async () => {
    const user = await seedUser("m09");
    const enabled = await enableMfaFor(user);
    const app = buildApp();

    const attempts: { status: number; body: unknown }[] = [];
    for (let attempt = 0; attempt < DISABLE_ATTEMPT_LIMIT + 1; attempt++) {
      const res = await postJson(app, "/api/account/mfa/disable", enabled.session.headers, {
        code: await wrongTotpCode(enabled.secret),
        kind: "totp",
      });
      attempts.push({ status: res.status, body: await res.json() });
    }

    // 枠を使い切るまでは 400、超えた分は use-case のロックアウトで 429。user 軸で数えるため
    // セッションを取り直しても枠が戻らない。SPA は body の error で待ち時間を書き分ける。
    expect(attempts.slice(0, DISABLE_ATTEMPT_LIMIT).map((attempt) => attempt.status)).toEqual(
      Array(DISABLE_ATTEMPT_LIMIT).fill(400) as number[],
    );
    expect(attempts.at(-1)).toEqual({ status: 429, body: { error: "locked" } });

    expect(await countMfaTotpRows(user.id)).toBe(1);
    expect((await findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
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

  test("QA-M-25 登録済み未有効も enabled/in_effect false (in_effect ≡ enabled の恒等)", async () => {
    const user = await seedUser("m25");
    const session = await createSessionFor(user.id);
    const app = buildApp();
    const enrolled = await app.request("/api/account/mfa/enroll", {
      method: "POST",
      headers: Object.fromEntries(session.headers),
    });
    expect(enrolled.status).toBe(200);

    const res = await app.request("/api/account/mfa", { headers: session.headers });

    expect(res.status).toBe(200);
    // 「中断した有効化 / 無効化」はフラグ×行の不整合の化石で、行のみが状態を持つ現構成では
    // 構造的に不在 (ADR-0016 §3.1)。in_effect は互換 field として enabled と常に同値。
    expect(await res.json()).toEqual({
      enabled: false,
      in_effect: false,
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
    // 失敗応答に Retry-After が付かないことを固定 (busy 経路は消滅 — ADR-0016 §5.4)。
    expect(res.headers.get("retry-after")).toBeNull();
  });

  test("QA-E-04 有効ユーザーの activate 再実行 → 409 (正しいコードでも副作用なし)", async () => {
    const user = await seedUser("e04");
    const enabled = await enableMfaFor(user);

    const res = await postJson(buildApp(), "/api/account/mfa/activate", enabled.session.headers, {
      code: await totpCode(enabled.secret),
      enrollment_id: enabled.enrollmentId,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already_enabled" });
    // revoke が走っていないこと (走ると本人の他デバイスが理由なく失効する)。
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("QA-M-06 未登録ユーザーの activate → 404 not_found", async () => {
    const user = await seedUser("m06");
    const session = await createSessionFor(user.id);

    const res = await postJson(buildApp(), "/api/account/mfa/activate", session.headers, {
      code: "123456",
      enrollment_id: "no-enrollment",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  test("QA-E-02 activate の識別子不一致 → 409 enrollment_changed (行は未 verified のまま)", async () => {
    const user = await seedUser("e02-changed");
    const session = await createSessionFor(user.id);
    const app = buildApp();
    const enrolled = await app.request("/api/account/mfa/enroll", {
      method: "POST",
      headers: Object.fromEntries(session.headers),
    });
    expect(enrolled.status).toBe(200);

    const res = await postJson(app, "/api/account/mfa/activate", session.headers, {
      code: "123456",
      enrollment_id: "stale-enrollment-id",
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "enrollment_changed" });
    expect((await findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
  });

  test("QA-E-02 activateの不正な登録識別子は400で副作用を起こさない", async () => {
    const user = await seedUser("invalid-enrollment-id");
    const session = await createSessionFor(user.id);

    const res = await postJson(buildApp(), "/api/account/mfa/activate", session.headers, {
      code: "123456",
      enrollment_id: 42,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_argument" });
    expect(await countMfaTotpRows(user.id)).toBe(0);
  });

  test("AC-145 enrollment_id の欠落・空文字は 400 invalid_argument (必須化の境界)", async () => {
    const user = await seedUser("ac145");
    const session = await createSessionFor(user.id);
    const app = buildApp();

    const missing = await postJson(app, "/api/account/mfa/activate", session.headers, {
      code: "123456",
    });
    const empty = await postJson(app, "/api/account/mfa/activate", session.headers, {
      code: "123456",
      enrollment_id: "",
    });

    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid_argument" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "invalid_argument" });
  });
});
