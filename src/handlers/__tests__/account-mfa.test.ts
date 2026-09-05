import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { requestApp, responseJson } from "./helpers";
import { Effect } from "effect";
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
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { accountMfa } from "../account-mfa";

// account MFA API (src/handlers/account-mfa.ts) の統合テスト。
// 対象ユーザーは requireActor が解決した 1 人だけで、body の内容では動かない — セッションを
// 持つ誰もが他人の第二要素を外せる状態にしないための境界がここ。
// wire の期待 JSON は旧実装のテストから不変 (「wire 不変」の最終観測 — ADR-0016)。

const P = "mfa-h-account-";
const { run, cleanup } = dbTest(P);

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

const postJson = (app: Hono, path: string, headers: Headers, body: unknown) =>
  requestApp(app, path, {
    method: "POST",
    headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("account MFA API", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-D-02 他人 userId 送っても本人のみ", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const actorUser = yield* db.seedUser("d02-actor");
        const victimUser = yield* db.seedUser("d02-victim");
        const actor = yield* enableMfaFor(actorUser);
        yield* enableMfaFor(victimUser);

        const res = yield* postJson(buildApp(), "/api/account/mfa/disable", actor.session.headers, {
          code: yield* totpCode(actor.secret),
          kind: "totp",
          userId: victimUser.id,
          user_id: victimUser.id,
        });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({ ok: true });
        expect(yield* countMfaTotpRows(actorUser.id)).toBe(0);
        expect(yield* countRecoveryCodeRows(actorUser.id)).toBe(0);
        // 被害者側は 1 bit も動かない。
        expect(yield* countMfaTotpRows(victimUser.id)).toBe(1);
        expect((yield* findMfaTotpRow(victimUser.id))?.verifiedAt).not.toBeNull();
      }),
    ));

  test("QA-M-09 disable 誤コード連投 → アカウント単位でロックアウト", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m09");
        const enabled = yield* enableMfaFor(user);
        const app = buildApp();

        const attempts: { status: number; body: unknown }[] = [];
        for (let attempt = 0; attempt < DISABLE_ATTEMPT_LIMIT + 1; attempt++) {
          const res = yield* postJson(app, "/api/account/mfa/disable", enabled.session.headers, {
            code: yield* wrongTotpCode(enabled.secret),
            kind: "totp",
          });
          attempts.push({ status: res.status, body: yield* responseJson(res) });
        }

        // 枠を使い切るまでは 400、超えた分は use-case のロックアウトで 429。user 軸で数えるため
        // セッションを取り直しても枠が戻らない。SPA は body の error で待ち時間を書き分ける。
        expect(attempts.slice(0, DISABLE_ATTEMPT_LIMIT).map((attempt) => attempt.status)).toEqual(
          Array(DISABLE_ATTEMPT_LIMIT).fill(400) as number[],
        );
        expect(attempts.at(-1)).toEqual({ status: 429, body: { error: "locked" } });

        expect(yield* countMfaTotpRows(user.id)).toBe(1);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
      }),
    ));

  test("GET /api/account/mfa は有効状態・in_effect・リカバリーコード残数だけを返す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("status");
        const enabled = yield* enableMfaFor(user);

        const res = yield* requestApp(buildApp(), "/api/account/mfa", {
          headers: enabled.session.headers,
        });

        expect(res.status).toBe(200);
        // secret とリカバリーコードの実体を後から読み戻せる経路を作らないための response 形。
        expect(yield* responseJson(res)).toEqual({
          enabled: true,
          in_effect: true,
          recovery_codes_remaining: enabled.recoveryCodes.length,
        });
      }),
    ));

  test("QA-H-01 enroll の応答は登録情報とopaqueな登録識別子だけを返す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m03");
        const session = yield* createSessionFor(user.id);

        const res = yield* requestApp(buildApp(), "/api/account/mfa/enroll", {
          method: "POST",
          headers: Object.fromEntries(session.headers),
        });

        expect(res.status).toBe(200);
        const body = (yield* responseJson(res)) as {
          enrollment_id: string;
          totp_uri: string;
          recovery_codes: string[];
        };
        // secret 単体のキーを増やさない (実体は totp_uri のクエリにのみ載る)。
        expect(Object.keys(body).sort()).toEqual(["enrollment_id", "recovery_codes", "totp_uri"]);
        expect(body.enrollment_id.length).toBeGreaterThan(0);
        expect(new URL(body.totp_uri).searchParams.get("secret")).not.toBeNull();
        expect(Array.isArray(body.recovery_codes)).toBe(true);
      }),
    ));

  test("QA-M-04 未登録ユーザーの GET /api/account/mfa も同じキー形 (enabled/in_effect false)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m04");
        const session = yield* createSessionFor(user.id);

        const res = yield* requestApp(buildApp(), "/api/account/mfa", { headers: session.headers });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({
          enabled: false,
          in_effect: false,
          recovery_codes_remaining: 0,
        });
      }),
    ));

  test("QA-M-25 登録済み未有効も enabled/in_effect false (in_effect ≡ enabled の恒等)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m25");
        const session = yield* createSessionFor(user.id);
        const app = buildApp();
        const enrolled = yield* requestApp(app, "/api/account/mfa/enroll", {
          method: "POST",
          headers: Object.fromEntries(session.headers),
        });
        expect(enrolled.status).toBe(200);

        const res = yield* requestApp(app, "/api/account/mfa", { headers: session.headers });

        expect(res.status).toBe(200);
        // 「中断した有効化 / 無効化」はフラグ×行の不整合の化石で、行のみが状態を持つ現構成では
        // 構造的に不在 (ADR-0016 §3.1)。in_effect は互換 field として enabled と常に同値。
        expect(yield* responseJson(res)).toEqual({
          enabled: false,
          in_effect: false,
          recovery_codes_remaining: 0,
        });
      }),
    ));

  test("QA-E-01 有効ユーザーの enroll → 409 already_enabled", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e01");
        const enabled = yield* enableMfaFor(user);

        const res = yield* requestApp(buildApp(), "/api/account/mfa/enroll", {
          method: "POST",
          headers: Object.fromEntries(enabled.session.headers),
        });

        expect(res.status).toBe(409);
        expect(yield* responseJson(res)).toEqual({ error: "already_enabled" });
        // 失敗応答に Retry-After が付かないことを固定 (busy 経路は消滅 — ADR-0016 §5.4)。
        expect(res.headers.get("retry-after")).toBeNull();
      }),
    ));

  test("QA-E-04 有効ユーザーの activate 再実行 → 409 (正しいコードでも副作用なし)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e04");
        const enabled = yield* enableMfaFor(user);

        const res = yield* postJson(
          buildApp(),
          "/api/account/mfa/activate",
          enabled.session.headers,
          { code: yield* totpCode(enabled.secret), enrollment_id: enabled.enrollmentId },
        );

        expect(res.status).toBe(409);
        expect(yield* responseJson(res)).toEqual({ error: "already_enabled" });
        // revoke が走っていないこと (走ると本人の他デバイスが理由なく失効する)。
        expect(res.headers.getSetCookie()).toEqual([]);
      }),
    ));

  test("QA-M-06 未登録ユーザーの activate → 404 not_found", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m06");
        const session = yield* createSessionFor(user.id);

        const res = yield* postJson(buildApp(), "/api/account/mfa/activate", session.headers, {
          code: "123456",
          enrollment_id: "no-enrollment",
        });

        expect(res.status).toBe(404);
        expect(yield* responseJson(res)).toEqual({ error: "not_found" });
      }),
    ));

  test("QA-E-02 activate の識別子不一致 → 409 enrollment_changed (行は未 verified のまま)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e02-changed");
        const session = yield* createSessionFor(user.id);
        const app = buildApp();
        const enrolled = yield* requestApp(app, "/api/account/mfa/enroll", {
          method: "POST",
          headers: Object.fromEntries(session.headers),
        });
        expect(enrolled.status).toBe(200);

        const res = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: "123456",
          enrollment_id: "stale-enrollment-id",
        });

        expect(res.status).toBe(409);
        expect(yield* responseJson(res)).toEqual({ error: "enrollment_changed" });
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
      }),
    ));

  test("QA-E-02 activateの不正な登録識別子は400で副作用を起こさない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("invalid-enrollment-id");
        const session = yield* createSessionFor(user.id);

        const res = yield* postJson(buildApp(), "/api/account/mfa/activate", session.headers, {
          code: "123456",
          enrollment_id: 42,
        });

        expect(res.status).toBe(400);
        expect(yield* responseJson(res)).toEqual({ error: "invalid_argument" });
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("AC-145 enrollment_id の欠落・空文字は 400 invalid_argument (必須化の境界)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("ac145");
        const session = yield* createSessionFor(user.id);
        const app = buildApp();

        const missing = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: "123456",
        });
        const empty = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: "123456",
          enrollment_id: "",
        });

        expect(missing.status).toBe(400);
        expect(yield* responseJson(missing)).toEqual({ error: "invalid_argument" });
        expect(empty.status).toBe(400);
        expect(yield* responseJson(empty)).toEqual({ error: "invalid_argument" });
      }),
    ));
});
