import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../../../auth";
import { AuthApiError } from "../../../errors";
import { getRedis } from "../../../redis";
import { runTest, expectFailure, auditRowsFor, partial } from "../../../__tests__/live-runner";
import { TestDb } from "../../../__tests__/test-db";
import {
  browserCookieHeaders,
  cleanupIssuedChallenges,
  enableMfaFor,
  installSentryRecorder,
  issueTestChallenge,
  requestHeaders,
  tamperCookieSignature,
  totpCode,
  wrongTotpCode,
} from "../../__tests__/helpers";
import { ChallengeExpired, InvalidCode, Locked } from "../../error-mapping";
import { completeLoginChallenge } from "../complete-login-challenge";
import {
  attemptsKey as attemptsKeyOf,
  buildLoginChallengeCookie,
  challengeKey,
  peekLoginChallenge,
  readLoginChallengeState,
} from "../login-challenge";
import { MfaSessions } from "../ports";
import { readOwnedMfaStatus } from "../read-status";
import { disable } from "../../totp";

// ログインチャレンジの発行 → 通過 (§10-4)。実 Redis + 実 gateway (issueSessionFor)。
// sign_in audit は live Layer の実書き込みを実 DB で観測する。

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
const redis = () => Effect.promise(() => getRedis());

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

        // 発行 (buildLoginChallengeCookie) の cookie 素材が載る Set-Cookie の形をここで固定する。
        const issued = yield* Effect.promise(() =>
          buildLoginChallengeCookie({
            userId: user.id,
            redirectUrl: CONSUMER_CALLBACK,
            method: "github",
          }),
        );
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
        // 後片付け対象に載せる。
        const opened = yield* peekLoginChallenge(
          browserCookieHeaders(new Response(null, { headers: reissued })),
        );
        if (opened) {
          const r = yield* redis();
          yield* Effect.promise(() => r.del(challengeKey(opened.challengeId)));
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
        // 出口検証は trusted origin の完全一致 — テスト env の信頼外 origin は fallback するため、
        // ここは same-origin path で「保存した遷移先が返る」ことを見る (信頼外は AC-142 の担当)。
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
        // Max-Age 明示付与 — browser-session cookie 化で寿命が揺れない (ADR-0016 §4.7)。
        expect(sessionCookies[0]).toMatch(/Max-Age=\d+/);
        expect(Number(/Max-Age=(\d+)/.exec(sessionCookies[0])?.[1])).toBeGreaterThan(0);
        // cookieCache (session_data) は発行時に作らない。
        expect(setCookies.some((c) => c.startsWith(`${authCookies.sessionData.name}=`))).toBe(
          false,
        );
        // チャレンジ cookie の失効指示。
        expect(
          setCookies.some((c) => c.startsWith("mfa_login_challenge=") && /max-age=0/i.test(c)),
        ).toBe(true);

        // 発行 session で getSession が user を解決する (PoC 0003 の再固定)。
        const browserHeaders = browserCookieHeaders(
          new Response(null, { headers: passed.forwardedHeaders }),
        );
        const session = yield* Effect.promise(() =>
          auth.api.getSession({ headers: browserHeaders }),
        );
        expect(session?.user.id).toBe(user.id);

        // sign_in audit 1 件 (method 付き)。
        const audits = yield* auditRowsFor(user.id, "sign_in");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toMatchObject({ method: "magic_link" });

        // 同一チャレンジの再使用 → 401、pending false。
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
        expect(audits[0]?.payload).toMatchObject({ method: "github" });
      }),
    ));

  test("AC-138/139 試行枠: 5 回目まで 400 + pending true、6 回目で破棄", () =>
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

        for (let attempt = 1; attempt <= 5; attempt++) {
          const rejected = yield* verifyFails(challenge.headers, {
            code: yield* wrongTotpCode(enabled.secret),
            kind: "totp",
          });
          expectFailure(rejected, InvalidCode, "invalid_code", 400);
          expect(yield* challengeState(challenge.headers)).toEqual({ pending: true });
        }

        // 6 回目: 400 のままチャレンジ破棄 (SPA の invalid_code → 再照会 → expired 契約を保存)。
        const exhausted = yield* verifyFails(challenge.headers, {
          code: yield* wrongTotpCode(enabled.secret),
          kind: "totp",
        });
        expectFailure(exhausted, InvalidCode, "invalid_code", 400);
        expect(yield* challengeState(challenge.headers)).toEqual({ pending: false });
        expect(sentry.messages.some((m) => m.message.includes("attempt budget exhausted"))).toBe(
          true,
        );

        // 以後は 401。正しいコードでも通れない。audit は 0 件。
        const after = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });
        expectFailure(after, ChallengeExpired, "challenge_expired", 401);
        expect(yield* auditRowsFor(user.id, "sign_in")).toEqual([]);
      }),
    ));

  test("AC-140 試行計数の Redis 不能 → 429 locked (fail-closed)", () =>
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
        // INCR できない値を置く — mock でなく実際に失敗する Redis 操作で fail-closed を確かめる。
        const r = yield* redis();
        yield* Effect.promise(() =>
          r.set(attemptsKeyOf(challenge.challengeId), "not-a-number", { EX: 60 }),
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
        const failingSessions = Layer.succeed(
          MfaSessions,
          partial<MfaSessions["Service"]>({
            issueSession: () =>
              Effect.fail(new AuthApiError({ cause: new Error("session store unavailable") })),
          }),
        );

        // boundary error (AuthApiError) として E channel に載る = 成功応答にならない (adapter は 500)。
        const failed = yield* Effect.flip(
          completeLoginChallenge(challenge.headers, {
            code: yield* totpCode(enabled.secret),
            kind: "totp",
          }).pipe(Effect.provide(failingSessions)),
        );
        expect(failed).toBeInstanceOf(AuthApiError);

        // 消費済み fail-closed = 再ログイン導線 (成功扱いにすると session 無しの成功応答になる)。
        const after = yield* verifyFails(challenge.headers, {
          code: yield* totpCode(enabled.secret, 1),
          kind: "totp",
        });
        expectFailure(after, ChallengeExpired, "challenge_expired", 401);
      }),
    ));
});
