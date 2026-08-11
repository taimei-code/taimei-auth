import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createSeedHelpers } from "./helpers";
import {
  assertChallengeServedFromRedis,
  cleanupIssuedChallenges,
  enableMfaFor,
  issueTestChallenge,
  rewriteChallengeExpiry,
  requestHeaders,
  signCookieValue,
  tamperCookieSignature,
  totpCode,
} from "../../mfa/__tests__/helpers";
import { mfaChallenge } from "../mfa-challenge";

// pre-session チャレンジ API (src/handlers/mfa-challenge.ts) の統合テスト。
// requireActor を通らずチャレンジ cookie を認証材料にする二本目の認証経路なので、
// cookie 無し / 改ざん の 2 ケースは認可スモークと同格の扱いで固定する。
// route は mountAccountRoutes でなく個別 app.route (canary-token と同じ) なのでここでも個別に張る。

const P = "mfa-h-challenge-";
const { cleanup, seedUser } = createSeedHelpers(P);

const buildApp = (): Hono => {
  const app = new Hono();
  app.route("/", mfaChallenge);
  return app;
};

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

describe("MFA チャレンジ API", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-H-04 正しい TOTP → 200 + Set-Cookie 転送", async () => {
    const user = await seedUser("h04");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account/security",
      method: "magic_link",
    });

    const res = await buildApp().request("/api/mfa/challenge/verify", {
      method: "POST",
      headers: { ...Object.fromEntries(challenge.headers), "content-type": "application/json" },
      body: JSON.stringify({ code: await totpCode(enabled.secret), kind: "totp" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect_url: "/account/security" });
    // 転送漏れは「ログインできたのにセッションが無い」で、画面からは原因不明の再ログインに見える。
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.length).toBeGreaterThan(0);
  });

  test("QA-E-04 cookie 無し → 401", async () => {
    const res = await buildApp().request("/api/mfa/challenge/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123456", kind: "totp" }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "challenge_expired" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("QA-E-05 改ざん cookie → 401 情報漏洩なし", async () => {
    const user = await seedUser("e05");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "https://app.example.com/dashboard",
      method: "github",
    });
    const tampered = tamperCookieSignature(await signCookieValue(challenge.challengeId));
    const tamperedHeaders = requestHeaders({ [challenge.cookieName]: tampered });
    const app = buildApp();

    const verifyRes = await app.request("/api/mfa/challenge/verify", {
      method: "POST",
      headers: { ...Object.fromEntries(tamperedHeaders), "content-type": "application/json" },
      body: JSON.stringify({ code: await totpCode(enabled.secret), kind: "totp" }),
    });
    const statusRes = await app.request("/api/mfa/challenge", { headers: tamperedHeaders });

    expect(verifyRes.status).toBe(401);
    // 署名検証に落ちたのか期限切れなのかを区別させず、遷移先・userId・第二要素の種別も返さない。
    expect(await verifyRes.json()).toEqual({ error: "challenge_expired" });
    expect(verifyRes.headers.getSetCookie()).toEqual([]);
    expect(await statusRes.json()).toEqual({ pending: false });
  });

  test("QA-M-08 期限切れ cookie → 401 情報漏洩なし", async () => {
    const user = await seedUser("m08");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account/security",
      method: "magic_link",
    });
    const expiresAt = new Date(Date.now() - 60_000);
    await rewriteChallengeExpiry(challenge, expiresAt);
    await assertChallengeServedFromRedis(challenge, expiresAt);

    const res = await buildApp().request("/api/mfa/challenge/verify", {
      method: "POST",
      headers: { ...Object.fromEntries(challenge.headers), "content-type": "application/json" },
      body: JSON.stringify({ code: await totpCode(enabled.secret), kind: "totp" }),
    });

    expect(res.status).toBe(401);
    // cookie 無し / 改ざん と同一 body — どの段階で落ちたかを未認証のブラウザに教えない
    expect(await res.json()).toEqual({ error: "challenge_expired" });
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  test("有効なチャレンジの状態取得は pending だけを返す", async () => {
    const user = await seedUser("status");
    await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "https://app.example.com/dashboard",
      method: "github",
    });

    const res = await buildApp().request("/api/mfa/challenge", { headers: challenge.headers });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: true });
  });
});
