import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../../../auth";
import { AuthApi } from "../../../auth-service";
import { authApiLive } from "../../../auth-wiring";
import { AuthApiError, TtlStoreError } from "../../../errors";
import { getMemoryKvStore } from "../../../ttl-store";
import { TtlStore } from "../../../ttl-store-service";
import { runTest, expectFailure, auditRowsFor } from "../../../__tests__/live-runner";
import { TestDb } from "../../../__tests__/test-db";
import {
  browserCookieHeaders,
  cleanupIssuedChallenges,
  enableMfaFor,
  installSentryRecorder,
  issueTestChallenge,
  requestHeaders,
  tamperCookieSignature,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  totpCode,
  wrongTotpCode,
} from "../../__tests__/helpers";
import { ChallengeExpired, InvalidCode, Locked } from "../../error-mapping";
import { completeLoginChallenge } from "../complete-login-challenge";
import {
  attemptsKey as attemptsKeyOf,
  challengeKey,
  openLoginChallenge,
  peekLoginChallenge,
  readLoginChallengeState,
} from "../login-challenge";
import { readOwnedMfaStatus } from "../read-status";
import { disable } from "../../totp";

const P = "mfa-lc-";
const run = runTest(P);
const sentry = installSentryRecorder();

const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

const cleanupAll = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
    }),
  );

const verify = completeLoginChallenge;
const verifyFails = (headers: Headers, input: { code: string; kind: "totp" | "recovery_code" }) =>
  Effect.flip(completeLoginChallenge(headers, input));
const challengeState = readLoginChallengeState;
const sendWrongTotpCodes = (headers: Headers, secret: string, times: number) =>
  Effect.gen(function* () {
    for (let attempt = 1; attempt <= times; attempt++) {
      yield* verifyFails(headers, { code: yield* wrongTotpCode(secret), kind: "totp" });
    }
  });

describe("ログインチャレンジ", () => {
  beforeEach(() => cleanupAll().then(() => sentry.reset()));
  afterAll(() => cleanupAll().then(() => sentry.restore()));

  test("AC-133 発行: Set-Cookie 属性と pending、改ざん・欠落は false", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("issue");
        yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });

        const issued = yield* openLoginChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "github",
        });
        const reissued = new Headers();
        reissued.append(
          "set-cookie",
          serializeSetCookie(issued.name, issued.value, issued.attributes),
        );
        const setCookie = reissued.getSetCookie();
        expect(setCookie.length).toBe(1);
        expect(setCookie[0]).toContain("mfa_login_challenge=");
        expect(setCookie[0]).toContain("Max-Age=600");
        expect(setCookie[0]).toContain("HttpOnly");
        expect(setCookie[0]).toContain("SameSite=Lax");
        expect(setCookie[0]).not.toContain("Domain=");
        const opened = yield* peekLoginChallenge(
          browserCookieHeaders(new Response(null, { headers: reissued })),
        );
        if (opened) {
          yield* Effect.sync(() => getMemoryKvStore().delete(challengeKey(opened.challengeId)));
        }

        expect(yield* challengeState(challenge.headers)).toEqual({ pending: true });
        expect(yield* challengeState(requestHeaders())).toEqual({ pending: false });
        const tampered = requestHeaders({
          [challenge.cookieName]: encodeURIComponent(tamperCookieSignature(challenge.signedValue)),
        });
        expect(yield* challengeState(tampered)).toEqual({ pending: false });
      }),
    ));

  test("AC-134/135/137 TOTP 通過: session 発行・audit・単回消費", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("pass");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: "/account/security",
          method: "magic_link",
        });

        const passed = yield* verify(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });
        expect(passed.redirectUrl).toBe("/account/security");

        const setCookies = passed.forwardedHeaders.getSetCookie();
        const { authCookies } = yield* Effect.promise(() => auth.$context);
        const sessionCookies = setCookies.filter((c) =>
          c.startsWith(`${authCookies.sessionToken.name}=`),
        );
        expect(sessionCookies.length).toBe(1);
        expect(sessionCookies[0]).toMatch(/Max-Age=\d+/);
        expect(Number(/Max-Age=(\d+)/.exec(sessionCookies[0])?.[1])).toBeGreaterThan(0);
        expect(setCookies.some((c) => c.startsWith(`${authCookies.sessionData.name}=`))).toBe(
          false,
        );
        expect(
          setCookies.some((c) => c.startsWith("mfa_login_challenge=") && /max-age=0/i.test(c)),
        ).toBe(true);

        const browserHeaders = browserCookieHeaders(
          new Response(null, { headers: passed.forwardedHeaders }),
        );
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: browserHeaders }),
        );
        expect(session?.user.id).toBe(user.id);

        const audits = yield* auditRowsFor(user.id, "sign_in");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          method: "magic_link",
          ip: TEST_CLIENT_IP,
          userAgent: TEST_USER_AGENT,
        });

        const replayed = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret, 1),
          kind: "totp",
        });
        expectFailure(replayed, ChallengeExpired, "challenge_expired", 401);
        expect(yield* challengeState(challenge.headers)).toEqual({ pending: false });
      }),
    ));

  test("AC-136 リカバリーコード通過: 成功 + 残数減", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("recovery");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "github",
        });

        const passed = yield* verify(challenge.headers, {
          code: enabled.recoveryCodes[0],
          kind: "recovery_code",
        });

        expect(passed.forwardedHeaders).toBeInstanceOf(Headers);
        expect(yield* readOwnedMfaStatus(enabled.actor)).toMatchObject({
          recoveryCodesRemaining: 9,
        });
        const audits = yield* auditRowsFor(user.id, "sign_in");
        expect(audits[0]?.payload).toEqual({
          method: "github",
          ip: TEST_CLIENT_IP,
          userAgent: TEST_USER_AGENT,
        });
      }),
    ));

  test("AC-138/139 試行枠: 4 回目まで 400 + pending true、最後の 5 回目の誤コードで破棄して challenge_expired", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("attempts");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        const exhaustedWarnings = () =>
          sentry.messages.filter(
            (m) =>
              m.message === "mfa: login challenge attempt budget exhausted" &&
              m.context?.tags?.component === "mfa-login-challenge",
          );

        for (let attempt = 1; attempt <= 4; attempt++) {
          const rejected = yield* verifyFails(challenge.headers, {
            code: yield* wrongTotpCode(enabled.secret),
            kind: "totp",
          });
          expectFailure(rejected, InvalidCode, "invalid_code", 400);
          expect(yield* challengeState(challenge.headers)).toEqual({ pending: true });
        }
        expect(exhaustedWarnings()).toHaveLength(0);

        const lastAttempt = yield* verifyFails(challenge.headers, {
          code: yield* wrongTotpCode(enabled.secret),
          kind: "totp",
        });
        expectFailure(lastAttempt, ChallengeExpired, "challenge_expired", 401);
        expect(yield* challengeState(challenge.headers)).toEqual({ pending: false });
        expect(exhaustedWarnings()).toHaveLength(1);

        const sixth = yield* verifyFails(challenge.headers, {
          code: yield* wrongTotpCode(enabled.secret),
          kind: "totp",
        });
        expectFailure(sixth, ChallengeExpired, "challenge_expired", 401);
        expect(yield* challengeState(challenge.headers)).toEqual({ pending: false });

        const after = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });
        expectFailure(after, ChallengeExpired, "challenge_expired", 401);
        expect(yield* auditRowsFor(user.id, "sign_in")).toEqual([]);
      }),
    ));

  test("試行枠の境界: 誤コード 4 回の後なら 5 回目の正しいコードで通過する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("budget-inside");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        yield* sendWrongTotpCodes(challenge.headers, enabled.secret, 4);

        const passed = yield* verify(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expect(passed.forwardedHeaders.getSetCookie().length).toBeGreaterThan(0);
        expect(yield* auditRowsFor(user.id, "sign_in")).toHaveLength(1);
      }),
    ));

  test("試行枠の境界: 誤コード 5 回の後は 6 回目の正しいコードでも challenge_expired", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("budget-outside");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        yield* sendWrongTotpCodes(challenge.headers, enabled.secret, 5);

        const rejected = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expectFailure(rejected, ChallengeExpired, "challenge_expired", 401);
        expect(yield* auditRowsFor(user.id, "sign_in")).toEqual([]);
      }),
    ));

  test("並行送信で枠を超えた送信は、正しいコードでも破棄して challenge_expired", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("budget-overrun");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        yield* Effect.sync(() =>
          getMemoryKvStore().set(attemptsKeyOf(challenge.challengeId), "5", 60),
        );

        const rejected = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expectFailure(rejected, ChallengeExpired, "challenge_expired", 401);
        expect(yield* challengeState(challenge.headers)).toEqual({ pending: false });
      }),
    ));

  test("チャレンジを消せなくても最後の誤コードには challenge_expired を返し、消し損ねを Sentry に記録する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("expire-delete-fails");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        yield* sendWrongTotpCodes(challenge.headers, enabled.secret, 4);
        const ttlStore = yield* TtlStore;

        const rejected = yield* verifyFails(challenge.headers, {
          code: yield* wrongTotpCode(enabled.secret),
          kind: "totp",
        }).pipe(
          Effect.provideService(TtlStore, {
            ...ttlStore,
            delete: () =>
              Effect.fail(new TtlStoreError({ cause: new Error("test: delete failed") })),
          }),
        );

        expectFailure(rejected, ChallengeExpired, "challenge_expired", 401);
        expect(
          sentry.exceptions.filter((e) => e.context?.tags?.component === "mfa-login-challenge"),
        ).toHaveLength(1);
      }),
    ));

  test("AC-140 試行計数の TTL store 不能 → 429 locked (fail-closed)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("unavailable");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        // INCR できない値で実際に失敗させる。
        yield* Effect.sync(() =>
          getMemoryKvStore().set(attemptsKeyOf(challenge.challengeId), "not-a-number", 60),
        );

        const rejected = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expectFailure(rejected, Locked, "locked", 429);
        expect(yield* challengeState(challenge.headers)).toEqual({ pending: true });
      }),
    ));

  test("AC-141 チャレンジ発行後の無効化交差 → 401 (not_enabled を漏らさない)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("cross");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });

        const disabled = yield* disable({
          actor: enabled.actor,
          headers: enabled.session.headers,
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });
        expect(disabled.sessionChanges).toBeInstanceOf(Headers);

        const rejected = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret, 1),
          kind: "totp",
        });
        expectFailure(rejected, ChallengeExpired, "challenge_expired", 401);
      }),
    ));

  test("AC-142 信頼外 redirectUrl は /account へ fallback (出口検証)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("redirect");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: "https://evil.example.net/phish",
          method: "magic_link",
        });

        const passed = yield* verify(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expect(passed.redirectUrl).toBe("/account");
      }),
    ));

  test("AC-158 session 発行失敗はチャレンジ消費後 — 再 verify は 401 (fail-closed)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("issue-fail");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: CONSUMER_CALLBACK,
          method: "magic_link",
        });
        const sessionStoreDown = new AuthApiError({
          cause: new Error("session store unavailable"),
        });
        const failingAuthApi = Layer.succeed(
          AuthApi,
          AuthApi.of({ ...authApiLive, issueSession: () => sessionStoreDown }),
        );

        const failed = yield* Effect.flip(
          completeLoginChallenge(challenge.headers, {
            code: yield* totpCode(enabled.secret),
            kind: "totp",
          }).pipe(Effect.provide(failingAuthApi)),
        );
        expect(failed).toBe(sessionStoreDown);

        const after = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret, 1),
          kind: "totp",
        });
        expectFailure(after, ChallengeExpired, "challenge_expired", 401);
      }),
    ));
});
