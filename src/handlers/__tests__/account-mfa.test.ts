import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { buildAppWith, requestApp, responseJson } from "./helpers";
import { Effect, Layer, Schema } from "effect";
import { Hono } from "hono";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  createSessionFor,
  enableMfaFor,
  findMfaTotpRow,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "../../mfa/__tests__/helpers";
import { AuthApi, SessionRejected } from "../../auth-service";
import { authApiLive } from "../../auth-wiring";
import { MfaEnrollment } from "../../mfa/mfa-contract";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { mountSpaApi } from "../spa-http-api";

const P = "mfa-h-account-";
const { run, cleanup } = dbTest(P);

// src/mfa/disable-attempt-budget.ts の MAX_ATTEMPTS と同じ。
const DISABLE_ATTEMPT_LIMIT = 5;

const buildApp = (): Hono => {
  const app = new Hono();
  mountSpaApi(app);
  return app;
};

const postJson = (app: Hono, path: string, headers: Headers, body?: unknown) =>
  requestApp(app, path, {
    method: "POST",
    headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const FORWARDED_COOKIES = ["a=1; Path=/; HttpOnly", "b=2; Path=/; HttpOnly"];

const appWithAuthApi = (overrides: Partial<AuthApi["Service"]>): Hono =>
  buildAppWith(Layer.succeed(AuthApi, AuthApi.of({ ...authApiLive, ...overrides })));

const appForwardingCookies = () =>
  appWithAuthApi({
    revokeOtherSessions: () =>
      Effect.succeed(new Headers(FORWARDED_COOKIES.map((c) => ["set-cookie", c]))),
  });

const expectEmptyBadRequest = (res: Response) =>
  Effect.gen(function* () {
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toBeNull();
    expect(yield* Effect.promise(() => res.text())).toBe("");
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

        expect(attempts.slice(0, DISABLE_ATTEMPT_LIMIT).map((attempt) => attempt.status)).toEqual(
          Array(DISABLE_ATTEMPT_LIMIT).fill(400) as number[],
        );
        expect(attempts.at(-1)).toEqual({ status: 429, body: { _tag: "Locked" } });

        expect(yield* countMfaTotpRows(user.id)).toBe(1);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
      }),
    ));

  test("GET /api/account/mfa は有効状態とリカバリーコード残数だけを返す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("status");
        const enabled = yield* enableMfaFor(user);

        const res = yield* requestApp(buildApp(), "/api/account/mfa", {
          headers: enabled.session.headers,
        });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({
          enabled: true,
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

        const res = yield* postJson(buildApp(), "/api/account/mfa/enroll", session.headers);

        expect(res.status).toBe(200);
        const body = (yield* responseJson(res)) as {
          enrollment_id: string;
          totp_uri: string;
          recovery_codes: string[];
        };
        expect(Object.keys(body).sort()).toEqual(["enrollment_id", "recovery_codes", "totp_uri"]);
        expect(body.enrollment_id.length).toBeGreaterThan(0);
        expect(new URL(body.totp_uri).searchParams.get("secret")).not.toBeNull();
        expect(Array.isArray(body.recovery_codes)).toBe(true);
      }),
    ));

  test("QA-M-04 未登録ユーザーの GET /api/account/mfa も同じキー形 (enabled false)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m04");
        const session = yield* createSessionFor(user.id);

        const res = yield* requestApp(buildApp(), "/api/account/mfa", { headers: session.headers });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({
          enabled: false,
          recovery_codes_remaining: 0,
        });
      }),
    ));

  test("QA-M-25 登録済み未有効も enabled false", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m25");
        const session = yield* createSessionFor(user.id);
        const app = buildApp();
        const enrolled = yield* postJson(app, "/api/account/mfa/enroll", session.headers);
        expect(enrolled.status).toBe(200);

        const res = yield* requestApp(app, "/api/account/mfa", { headers: session.headers });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({
          enabled: false,
          recovery_codes_remaining: 0,
        });
      }),
    ));

  test("QA-E-01 有効ユーザーの enroll → 409 AlreadyEnabled", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e01");
        const enabled = yield* enableMfaFor(user);

        const res = yield* postJson(buildApp(), "/api/account/mfa/enroll", enabled.session.headers);

        expect(res.status).toBe(409);
        expect(res.headers.get("content-type")).toBe("application/json");
        expect(yield* responseJson(res)).toEqual({ _tag: "AlreadyEnabled" });
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
        expect(yield* responseJson(res)).toEqual({ _tag: "AlreadyEnabled" });
        expect(res.headers.getSetCookie()).toEqual([]);
      }),
    ));

  test("QA-M-06 未登録ユーザーの activate → 404 MfaNotFound", () =>
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
        expect(yield* responseJson(res)).toEqual({ _tag: "MfaNotFound" });
      }),
    ));

  test("QA-E-02 activate の識別子不一致 → 409 EnrollmentChanged (行は未 verified のまま)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e02-changed");
        const session = yield* createSessionFor(user.id);
        const app = buildApp();
        const enrolled = yield* postJson(app, "/api/account/mfa/enroll", session.headers);
        expect(enrolled.status).toBe(200);

        const res = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: "123456",
          enrollment_id: "stale-enrollment-id",
        });

        expect(res.status).toBe(409);
        expect(yield* responseJson(res)).toEqual({ _tag: "EnrollmentChanged" });
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
      }),
    ));

  test("activate の成功の応答に、better-auth が返した Set-Cookie を 1 つずつ付ける", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("activate-cookies");
        const session = yield* createSessionFor(user.id);
        const app = appForwardingCookies();
        const enrolled = yield* postJson(app, "/api/account/mfa/enroll", session.headers);
        const enrollment = yield* Schema.decodeUnknownEffect(MfaEnrollment)(
          yield* responseJson(enrolled),
        );

        const res = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: yield* totpCode(secretFromTotpUri(enrollment.totp_uri)),
          enrollment_id: enrollment.enrollment_id,
        });

        expect([res.status, res.headers.getSetCookie()]).toEqual([200, FORWARDED_COOKIES]);
      }),
    ));

  test("disable の成功の応答に、better-auth が返した Set-Cookie を 1 つずつ付ける", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const enabled = yield* enableMfaFor(yield* db.seedUser("disable-cookies"));

        const res = yield* postJson(
          appForwardingCookies(),
          "/api/account/mfa/disable",
          enabled.session.headers,
          { code: yield* totpCode(enabled.secret), kind: "totp" },
        );

        expect([res.status, res.headers.getSetCookie()]).toEqual([200, FORWARDED_COOKIES]);
      }),
    ));

  test("activate の revoke を better-auth が拒否 → 401 Unauthorized (行は未 verified のまま)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("revoke-rejected");
        const session = yield* createSessionFor(user.id);
        const revokes: Headers[] = [];
        const app = appWithAuthApi({
          revokeOtherSessions: (headers) => {
            revokes.push(headers);
            return new SessionRejected();
          },
        });
        const enrolled = yield* postJson(app, "/api/account/mfa/enroll", session.headers);
        const enrollment = yield* Schema.decodeUnknownEffect(MfaEnrollment)(
          yield* responseJson(enrolled),
        );

        const res = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: yield* totpCode(secretFromTotpUri(enrollment.totp_uri)),
          enrollment_id: enrollment.enrollment_id,
        });

        expect(res.status).toBe(401);
        expect(yield* responseJson(res)).toEqual({ _tag: "Unauthorized" });
        expect(revokes.length).toBe(1);
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

        yield* expectEmptyBadRequest(res);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("AC-145 enrollment_id の欠落・空文字は 400 (decode 失敗、body 無し、必須化の境界)", () =>
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

        yield* expectEmptyBadRequest(missing);
        yield* expectEmptyBadRequest(empty);
      }),
    ));
});
