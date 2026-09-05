import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { requestApp, responseJson } from "./helpers";
import { Effect } from "effect";
import { Hono } from "hono";
import {
  cleanupIssuedChallenges,
  enableMfaFor,
  issueTestChallenge,
  requestHeaders,
  tamperCookieSignature,
  totpCode,
} from "../../mfa/__tests__/helpers";
import { challengeKey } from "../../mfa/totp/login-challenge";
import { getRedis } from "../../redis";
import { runTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { mfaChallenge } from "../mfa-challenge";

// pre-session チャレンジ API (src/handlers/mfa-challenge.ts) の統合テスト。
// requireActor を通らずチャレンジ cookie を認証材料にする二本目の認証経路なので、
// cookie 無し / 改ざん / 期限切れの 3 ケースは認可スモークと同格の扱いで固定する。

const P = "mfa-h-challenge-";
const run = runTest(P);

const buildApp = (): Hono => {
  const app = new Hono();
  app.route("/", mfaChallenge);
  return app;
};

const cleanupAll = () =>
  run(
    Effect.gen(function* () {
      yield* cleanupIssuedChallenges();
      yield* (yield* TestDb).cleanup();
    }),
  );

const verifyWith = (app: Hono, headers: Headers, body: unknown) =>
  requestApp(app, "/api/mfa/challenge/verify", {
    method: "POST",
    headers: { ...Object.fromEntries(headers), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("MFA チャレンジ API", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-H-04 正しい TOTP → 200 + Set-Cookie 転送", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("h04");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: "/account/security",
          method: "magic_link",
        });

        const res = yield* verifyWith(buildApp(), challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({ redirect_url: "/account/security" });
        // 転送漏れは「ログインできたのにセッションが無い」で、画面からは原因不明の再ログインに見える。
        const setCookies = res.headers.getSetCookie();
        expect(setCookies.length).toBeGreaterThan(0);
      }),
    ));

  test("QA-E-04 cookie 無し → 401", () =>
    run(
      Effect.gen(function* () {
        const res = yield* requestApp(buildApp(), "/api/mfa/challenge/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: "123456", kind: "totp" }),
        });

        expect(res.status).toBe(401);
        expect(yield* responseJson(res)).toEqual({ error: "challenge_expired" });
        expect(res.headers.getSetCookie()).toEqual([]);
      }),
    ));

  test("QA-E-05 改ざん cookie → 401 情報漏洩なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("e05");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: "https://app.example.com/dashboard",
          method: "github",
        });
        const tampered = tamperCookieSignature(challenge.signedValue);
        const tamperedHeaders = requestHeaders({
          [challenge.cookieName]: encodeURIComponent(tampered),
        });
        const app = buildApp();

        const verifyRes = yield* verifyWith(app, tamperedHeaders, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });
        const statusRes = yield* requestApp(app, "/api/mfa/challenge", {
          headers: tamperedHeaders,
        });

        expect(verifyRes.status).toBe(401);
        // 署名検証に落ちたのか期限切れなのかを区別させず、遷移先・userId・第二要素の種別も返さない。
        expect(yield* responseJson(verifyRes)).toEqual({ error: "challenge_expired" });
        expect(verifyRes.headers.getSetCookie()).toEqual([]);
        expect(yield* responseJson(statusRes)).toEqual({ pending: false });
      }),
    ));

  test("QA-M-08 期限切れ (Redis 消滅) → 401 情報漏洩なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("m08");
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: "/account/security",
          method: "magic_link",
        });
        // TTL 経過の決定的な再現: 実 store の key を消す (固定 sleep は使わない)。
        yield* Effect.promise(async () =>
          (await getRedis()).del(challengeKey(challenge.challengeId)),
        );

        const res = yield* verifyWith(buildApp(), challenge.headers, {
          code: yield* totpCode(enabled.secret),
          kind: "totp",
        });

        expect(res.status).toBe(401);
        // cookie 無し / 改ざんと同一 body — どの段階で落ちたかを未認証のブラウザに教えない。
        expect(yield* responseJson(res)).toEqual({ error: "challenge_expired" });
        expect(res.headers.getSetCookie()).toEqual([]);
      }),
    ));

  test("有効なチャレンジの状態取得は pending だけを返す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("status");
        yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: "https://app.example.com/dashboard",
          method: "github",
        });

        const res = yield* requestApp(buildApp(), "/api/mfa/challenge", {
          headers: challenge.headers,
        });

        expect(res.status).toBe(200);
        expect(yield* responseJson(res)).toEqual({ pending: true });
      }),
    ));
});
