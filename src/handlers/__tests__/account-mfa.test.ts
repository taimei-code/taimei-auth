import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { buildAppWith, requestApp, responseJson } from "./helpers";
import { Effect, Schema } from "effect";
import { Hono } from "hono";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  enableMfaFor,
  findMfaTotpRow,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "../../mfa/__tests__/helpers";
import { ageStoredSession, createSessionFor } from "../../__tests__/session-helpers";
import { AuthApi, SessionRejected } from "../../auth-service";
import { auditFailingLayer, auditLogWith, authApiWith } from "../../__tests__/test-layers";
import { ATTEMPT_BUDGETS } from "../../attempt-budget";
import { MfaEnrollment } from "../../mfa/mfa-contract";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { mountSpaApi } from "../spa-http-api";
import type { AuditLogEntry } from "@/db/repositories/audit-log";
import { spaEndpointTable } from "../../spa-contract-table";

const P = "mfa-h-account-";
const { run, cleanup } = dbTest(P);

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
  buildAppWith(authApiWith(() => overrides));

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

  test("他人の userId を送っても、本人の MFA の状態だけを扱う", () =>
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

  test("無効化に誤ったコードを続けて送ると、アカウント単位でロックする", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m09");
        const enabled = yield* enableMfaFor(user);
        const app = buildApp();

        const attempts: { status: number; body: unknown }[] = [];
        const disableLimit = ATTEMPT_BUDGETS.mfaDisablePerUser.maxAttempts();
        for (let attempt = 0; attempt < disableLimit + 1; attempt++) {
          const res = yield* postJson(app, "/api/account/mfa/disable", enabled.session.headers, {
            code: yield* wrongTotpCode(enabled.secret),
            kind: "totp",
          });
          attempts.push({ status: res.status, body: yield* responseJson(res) });
        }

        expect(attempts.slice(0, disableLimit).map((attempt) => attempt.status)).toEqual(
          Array(disableLimit).fill(400) as number[],
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

  test("enroll の応答は、登録情報と中身を読めない登録識別子だけを返す", () =>
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

  test("未登録の user の GET /api/account/mfa も同じ key の形で enabled false を返す", () =>
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

  test("登録済みで未有効の user も enabled false を返す", () =>
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

  test("MFA が有効な user の enroll は 409 AlreadyEnabled を返す", () =>
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

  test("MFA が有効な user が activate をもう一度実行すると、正しいコードでも 409 を返し、何も変えない", () =>
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

  test("未登録の user の activate は 404 MfaNotFound を返す", () =>
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

  test("activate の登録識別子が一致しないと 409 EnrollmentChanged を返し、行は未 verified のまま", () =>
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

  test("activate の不正な登録識別子は 400 を返し、何も変えない", () =>
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

  test("enrollment_id が無いか空文字なら、decode に失敗して本文の無い 400 を返す", () =>
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

const MINUTE_MS = 60 * 1000;
const SECOND_MS = 1000;
const PAST_WINDOW_MS = 10 * MINUTE_MS + SECOND_MS;
const WITHIN_WINDOW_MS = 9 * MINUTE_MS;

const recordingAudit = () => {
  const recorded: AuditLogEntry[] = [];
  const layer = auditLogWith((live) => ({
    appendAuditLog: (entry) => {
      recorded.push(entry);
      return live.appendAuditLog(entry);
    },
    appendAuditLogs: (entries, tx) => {
      recorded.push(...entries);
      return live.appendAuditLogs(entries, tx);
    },
  }));
  return { recorded, app: buildAppWith(layer) };
};

const declaredStatusOf = (endpointName: string, tag: unknown) =>
  spaEndpointTable()
    .find((endpoint) => endpoint.name === endpointName)
    ?.failures.get(String(tag));

const expectDeclaredNewFailure = (endpointName: string, res: Response) =>
  Effect.gen(function* () {
    const body = (yield* responseJson(res)) as { _tag?: unknown };
    expect(["Unauthorized", "RateLimited"]).not.toContain(body._tag);
    expect(declaredStatusOf(endpointName, body._tag)).toBe(res.status);
    return body;
  });

const enrollmentOf = (res: Response) =>
  responseJson(res).pipe(Effect.map((body) => Schema.decodeUnknownSync(MfaEnrollment)(body)));

const mfaEnabledOf = (app: Hono, headers: Headers) =>
  requestApp(app, "/api/account/mfa", { headers }).pipe(
    Effect.flatMap(responseJson),
    Effect.map((body) => (body as { enabled: boolean }).enabled),
  );

describe("MFA の登録と有効化は、発行から 10 分以内の session にだけ許す", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("発行から 10 分を過ぎた session の登録は、画面が判別できる宣言された失敗になり、登録内容を作らない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-enroll");
        const session = yield* createSessionFor(user.id);
        yield* ageStoredSession(session.token, { sinceCreatedMs: PAST_WINDOW_MS });
        const app = buildApp();

        const res = yield* postJson(app, "/api/account/mfa/enroll", session.headers);

        yield* expectDeclaredNewFailure("mfa.enroll", res);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
        expect(yield* mfaEnabledOf(app, session.headers)).toBe(false);
      }),
    ));

  test("登録の後に発行から 10 分を過ぎると、正しいコードの有効化も宣言された失敗になり、MFA は無効のまま", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-activate");
        const session = yield* createSessionFor(user.id);
        const app = buildApp();
        const enrollment = yield* enrollmentOf(
          yield* postJson(app, "/api/account/mfa/enroll", session.headers),
        );
        yield* ageStoredSession(session.token, { sinceCreatedMs: PAST_WINDOW_MS });

        const res = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: yield* totpCode(secretFromTotpUri(enrollment.totp_uri)),
          enrollment_id: enrollment.enrollment_id,
        });

        yield* expectDeclaredNewFailure("mfa.activate", res);
        expect((yield* findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
        expect(yield* mfaEnabledOf(app, session.headers)).toBe(false);
      }),
    ));

  test("発行から 10 分以内の session からは、登録と有効化が成功して MFA が有効になる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-fresh");
        const session = yield* createSessionFor(user.id);
        yield* ageStoredSession(session.token, { sinceCreatedMs: WITHIN_WINDOW_MS });
        const app = buildApp();

        const enrolled = yield* postJson(app, "/api/account/mfa/enroll", session.headers);
        expect(enrolled.status).toBe(200);
        const enrollment = yield* enrollmentOf(enrolled);
        const activated = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: yield* totpCode(secretFromTotpUri(enrollment.totp_uri)),
          enrollment_id: enrollment.enrollment_id,
        });

        expect(activated.status).toBe(200);
        expect(yield* mfaEnabledOf(app, session.headers)).toBe(true);
      }),
    ));

  test("有効化が時間窓で拒否された後にログインし直すと、登録は同じ内容を返し、認証アプリを登録し直さずに有効化できる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-resume");
        const oldSession = yield* createSessionFor(user.id);
        const app = buildApp();
        const first = yield* enrollmentOf(
          yield* postJson(app, "/api/account/mfa/enroll", oldSession.headers),
        );
        yield* ageStoredSession(oldSession.token, { sinceCreatedMs: PAST_WINDOW_MS });
        const secret = secretFromTotpUri(first.totp_uri);
        const rejected = yield* postJson(app, "/api/account/mfa/activate", oldSession.headers, {
          code: yield* totpCode(secret),
          enrollment_id: first.enrollment_id,
        });
        yield* expectDeclaredNewFailure("mfa.activate", rejected);

        const newSession = yield* createSessionFor(user.id);
        const replayed = yield* enrollmentOf(
          yield* postJson(app, "/api/account/mfa/enroll", newSession.headers),
        );
        const activated = yield* postJson(app, "/api/account/mfa/activate", newSession.headers, {
          code: yield* totpCode(secretFromTotpUri(replayed.totp_uri)),
          enrollment_id: replayed.enrollment_id,
        });

        expect(replayed.enrollment_id).toBe(first.enrollment_id);
        expect(secretFromTotpUri(replayed.totp_uri)).toBe(secret);
        expect(activated.status).toBe(200);
        expect(yield* mfaEnabledOf(app, newSession.headers)).toBe(true);
      }),
    ));

  test("時間窓を過ぎた登録と有効化の拒否は、それぞれ拒否した操作の分かる audit event を 1 件だけ残す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-audit");
        const { recorded, app } = recordingAudit();
        const oldSession = yield* createSessionFor(user.id);
        yield* ageStoredSession(oldSession.token, { sinceCreatedMs: PAST_WINDOW_MS });
        const freshSession = yield* createSessionFor(user.id);

        yield* expectDeclaredNewFailure(
          "mfa.enroll",
          yield* postJson(app, "/api/account/mfa/enroll", oldSession.headers),
        );
        const afterEnrollRejection = [...recorded];
        const enrollment = yield* enrollmentOf(
          yield* postJson(app, "/api/account/mfa/enroll", freshSession.headers),
        );
        yield* ageStoredSession(freshSession.token, { sinceCreatedMs: PAST_WINDOW_MS });
        const beforeActivateRejection = recorded.length;
        yield* expectDeclaredNewFailure(
          "mfa.activate",
          yield* postJson(app, "/api/account/mfa/activate", freshSession.headers, {
            code: yield* totpCode(secretFromTotpUri(enrollment.totp_uri)),
            enrollment_id: enrollment.enrollment_id,
          }),
        );
        const afterActivateRejection = recorded.slice(beforeActivateRejection);

        expect(afterEnrollRejection).toHaveLength(1);
        expect(beforeActivateRejection).toBe(1);
        expect(afterActivateRejection).toHaveLength(1);
        const [enrollRejection] = afterEnrollRejection;
        const [activateRejection] = afterActivateRejection;
        expect(enrollRejection?.userId).toBe(user.id);
        expect(activateRejection?.userId).toBe(user.id);
        expect(activateRejection?.eventType).toBe(enrollRejection?.eventType);
        expect(activateRejection?.payload).not.toEqual(enrollRejection?.payload);
      }),
    ));

  test("発行から 10 分以内の登録の成功は audit event を残さず、有効化の成功は MFA の有効化の audit event だけを残す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-no-audit");
        const { recorded, app } = recordingAudit();
        const session = yield* createSessionFor(user.id);

        const enrollment = yield* enrollmentOf(
          yield* postJson(app, "/api/account/mfa/enroll", session.headers),
        );
        const afterEnroll = recorded.length;
        const activated = yield* postJson(app, "/api/account/mfa/activate", session.headers, {
          code: yield* totpCode(secretFromTotpUri(enrollment.totp_uri)),
          enrollment_id: enrollment.enrollment_id,
        });

        expect(activated.status).toBe(200);
        expect(afterEnroll).toBe(0);
        expect(recorded.map((entry) => entry.eventType)).toEqual(["mfa_enabled"]);
      }),
    ));

  test("audit event の記帳が失敗しても、時間窓を過ぎた登録の拒否の応答は変わらない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-audit-down");
        const session = yield* createSessionFor(user.id);
        yield* ageStoredSession(session.token, { sinceCreatedMs: PAST_WINDOW_MS });

        const recordedResponse = yield* postJson(
          buildApp(),
          "/api/account/mfa/enroll",
          session.headers,
        );
        const failingResponse = yield* postJson(
          buildAppWith(auditFailingLayer("audit store down")),
          "/api/account/mfa/enroll",
          session.headers,
        );

        const recordedBody = yield* expectDeclaredNewFailure("mfa.enroll", recordedResponse);
        expect(failingResponse.status).toBe(recordedResponse.status);
        expect(yield* responseJson(failingResponse)).toEqual(recordedBody);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("MFA の無効化は、発行から 10 分を過ぎた session からでも正しいコードで成功する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-disable");
        const enabled = yield* enableMfaFor(user);
        yield* ageStoredSession(enabled.session.token, { sinceCreatedMs: PAST_WINDOW_MS });
        const app = buildApp();

        const res = yield* postJson(app, "/api/account/mfa/disable", enabled.session.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expect(res.status).toBe(200);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
        expect(yield* mfaEnabledOf(app, enabled.session.headers)).toBe(false);
      }),
    ));

  test("session の延長で更新時刻が新しくても、発行から 10 分を過ぎていれば登録は拒否される", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-extended");
        const session = yield* createSessionFor(user.id);
        yield* ageStoredSession(session.token, {
          sinceCreatedMs: PAST_WINDOW_MS,
          sinceUpdatedMs: 0,
        });

        const res = yield* postJson(buildApp(), "/api/account/mfa/enroll", session.headers);

        yield* expectDeclaredNewFailure("mfa.enroll", res);
        expect(yield* countMfaTotpRows(user.id)).toBe(0);
      }),
    ));

  test("試行枠を使い切った古い session の登録は試行枠の失敗になり、再認証の拒否の audit event を増やさない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("reauth-budget");
        const { recorded, app } = recordingAudit();
        const session = yield* createSessionFor(user.id);
        yield* ageStoredSession(session.token, { sinceCreatedMs: PAST_WINDOW_MS });
        const limit = ATTEMPT_BUDGETS.mfaChangePerSession.maxAttempts();
        for (let attempt = 0; attempt < limit; attempt++) {
          yield* postJson(app, "/api/account/mfa/enroll", session.headers);
        }
        const auditedWithinBudget = recorded.length;

        const res = yield* postJson(app, "/api/account/mfa/enroll", session.headers);

        expect(auditedWithinBudget).toBe(limit);
        expect([res.status, yield* responseJson(res)]).toEqual([429, { _tag: "RateLimited" }]);
        expect(recorded).toHaveLength(limit);
      }),
    ));
});
