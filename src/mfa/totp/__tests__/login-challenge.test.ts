import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { serialize as serializeSetCookie } from "hono/utils/cookie";
import { auth } from "../../../auth";
import { AuthApiError } from "../../../errors";
import { auditRowsFor, createSeedHelpers } from "../../../handlers/__tests__/helpers";
import { getRedis } from "../../../redis";
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
import { flipMfa, partial, runMfa, runMfaResult } from "../../__tests__/test-layers";
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
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

const CONSUMER_CALLBACK = "https://app.example.com/dashboard";

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

const verify = (headers: Headers, input: { code: string; kind: "totp" | "recovery_code" }) =>
  runMfaResult(completeLoginChallenge(headers, input));

const challengeState = (headers: Headers): Promise<{ pending: boolean }> =>
  runMfa(readLoginChallengeState(headers));

describe("ログインチャレンジ", () => {
  beforeEach(async () => {
    await cleanupAll();
    sentry.reset();
  });
  afterAll(async () => {
    await cleanupAll();
    sentry.restore();
  });

  test("AC-133 発行: Set-Cookie 属性と pending、改ざん・欠落は false", async () => {
    const user = await seedUser("issue");
    await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "magic_link",
    });

    // 発行 (buildLoginChallengeCookie) の cookie 素材が載る Set-Cookie の形をここで固定する。
    const issued = await buildLoginChallengeCookie({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "github",
    });
    const reissued = new Headers();
    reissued.append("set-cookie", serializeSetCookie(issued.name, issued.value, issued.attributes));
    const setCookie = reissued.getSetCookie();
    expect(setCookie.length).toBe(1);
    expect(setCookie[0]).toContain("mfa_login_challenge=");
    expect(setCookie[0]).toContain("Max-Age=600");
    expect(setCookie[0]).toContain("HttpOnly");
    expect(setCookie[0]).toContain("SameSite=Lax");
    expect(setCookie[0]).not.toContain("Domain=");
    // 後片付け対象に載せる。
    const opened = await runMfa(
      peekLoginChallenge(browserCookieHeaders(new Response(null, { headers: reissued }))),
    );
    if (opened) await (await getRedis()).del(challengeKey(opened.challengeId));

    expect(await challengeState(challenge.headers)).toEqual({ pending: true });
    expect(await challengeState(requestHeaders())).toEqual({ pending: false });
    const tampered = requestHeaders({
      [challenge.cookieName]: encodeURIComponent(tamperCookieSignature(challenge.signedValue)),
    });
    expect(await challengeState(tampered)).toEqual({ pending: false });
  });

  test("AC-134/135/137 TOTP 通過: session 発行・audit・単回消費", async () => {
    const user = await seedUser("pass");
    const enabled = await enableMfaFor(user);
    // 出口検証は trusted origin の完全一致 — テスト env の信頼外 origin は fallback するため、
    // ここは same-origin path で「保存した遷移先が返る」ことを見る (信頼外は AC-142 の担当)。
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account/security",
      method: "magic_link",
    });

    const passed = await verify(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.redirectUrl).toBe("/account/security");

    const setCookies = passed.forwardedHeaders.getSetCookie();
    const { authCookies } = await auth.$context;
    const sessionCookies = setCookies.filter((c) =>
      c.startsWith(`${authCookies.sessionToken.name}=`),
    );
    expect(sessionCookies.length).toBe(1);
    // Max-Age 明示付与 — browser-session cookie 化で寿命が揺れない (ADR-0016 §4.7)。
    expect(sessionCookies[0]).toMatch(/Max-Age=\d+/);
    expect(Number(/Max-Age=(\d+)/.exec(sessionCookies[0])?.[1])).toBeGreaterThan(0);
    // cookieCache (session_data) は発行時に作らない。
    expect(setCookies.some((c) => c.startsWith(`${authCookies.sessionData.name}=`))).toBe(false);
    // チャレンジ cookie の失効指示。
    expect(
      setCookies.some((c) => c.startsWith("mfa_login_challenge=") && /max-age=0/i.test(c)),
    ).toBe(true);

    // 発行 session で getSession が user を解決する (PoC 0003 の再固定)。
    const browserHeaders = browserCookieHeaders(
      new Response(null, { headers: passed.forwardedHeaders }),
    );
    const session = await auth.api.getSession({ headers: browserHeaders });
    expect(session?.user.id).toBe(user.id);

    // sign_in audit 1 件 (method 付き)。
    const audits = await auditRowsFor(user.id, "sign_in");
    expect(audits.length).toBe(1);
    expect(audits[0]?.payload).toMatchObject({ method: "magic_link" });

    // 同一チャレンジの再使用 → 401、pending false。
    const replayed = await verify(challenge.headers, {
      code: await totpCode(enabled.secret, 1),
      kind: "totp",
    });
    expect(replayed).toEqual(
      expect.objectContaining({ ok: false, error: "challenge_expired", status: 401 }),
    );
    expect(await challengeState(challenge.headers)).toEqual({ pending: false });
  });

  test("AC-136 リカバリーコード通過: 成功 + 残数減", async () => {
    const user = await seedUser("recovery");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "github",
    });

    const passed = await verify(challenge.headers, {
      code: enabled.recoveryCodes[0],
      kind: "recovery_code",
    });

    expect(passed.ok).toBe(true);
    expect(await runMfa(readOwnedMfaStatus(enabled.actor))).toMatchObject({
      recoveryCodesRemaining: 9,
    });
    const audits = await auditRowsFor(user.id, "sign_in");
    expect(audits[0]?.payload).toMatchObject({ method: "github" });
  });

  test("AC-138/139 試行枠: 5 回目まで 400 + pending true、6 回目で破棄", async () => {
    const user = await seedUser("attempts");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "magic_link",
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      const rejected = await verify(challenge.headers, {
        code: await wrongTotpCode(enabled.secret),
        kind: "totp",
      });
      expect(rejected).toEqual(
        expect.objectContaining({ ok: false, error: "invalid_code", status: 400 }),
      );
      expect(await challengeState(challenge.headers)).toEqual({ pending: true });
    }

    // 6 回目: 400 のままチャレンジ破棄 (SPA の invalid_code → 再照会 → expired 契約を保存)。
    const exhausted = await verify(challenge.headers, {
      code: await wrongTotpCode(enabled.secret),
      kind: "totp",
    });
    expect(exhausted).toEqual(expect.objectContaining({ ok: false, error: "invalid_code" }));
    expect(await challengeState(challenge.headers)).toEqual({ pending: false });
    expect(sentry.messages.some((m) => m.message.includes("attempt budget exhausted"))).toBe(true);

    // 以後は 401。正しいコードでも通れない。audit は 0 件。
    const after = await verify(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    expect(after).toEqual(expect.objectContaining({ ok: false, error: "challenge_expired" }));
    expect(await auditRowsFor(user.id, "sign_in")).toEqual([]);
  });

  test("AC-140 試行計数の Redis 不能 → 429 locked (fail-closed)", async () => {
    const user = await seedUser("unavailable");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "magic_link",
    });
    // INCR できない値を置く — mock でなく実際に失敗する Redis 操作で fail-closed を確かめる。
    const redis = await getRedis();
    await redis.set(attemptsKeyOf(challenge.challengeId), "not-a-number", { EX: 60 });

    const rejected = await verify(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(rejected).toEqual(expect.objectContaining({ ok: false, error: "locked", status: 429 }));
    expect(await challengeState(challenge.headers)).toEqual({ pending: true });
  });

  test("AC-141 チャレンジ発行後の無効化交差 → 401 (not_enabled を漏らさない)", async () => {
    const user = await seedUser("cross");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: CONSUMER_CALLBACK,
      method: "magic_link",
    });

    const disabled = await runMfaResult(
      disable({
        actor: enabled.actor,
        headers: enabled.session.headers,
        code: await totpCode(enabled.secret),
        kind: "totp",
      }),
    );
    expect(disabled.ok).toBe(true);

    const rejected = await verify(challenge.headers, {
      code: await totpCode(enabled.secret, 1),
      kind: "totp",
    });
    expect(rejected).toEqual(
      expect.objectContaining({ ok: false, error: "challenge_expired", status: 401 }),
    );
  });

  test("AC-142 信頼外 redirectUrl は /account へ fallback (出口検証)", async () => {
    const user = await seedUser("redirect");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "https://evil.example.net/phish",
      method: "magic_link",
    });

    const passed = await verify(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(passed.ok).toBe(true);
    if (!passed.ok) return;
    expect(passed.redirectUrl).toBe("/account");
  });

  test("AC-158 session 発行失敗はチャレンジ消費後 — 再 verify は 401 (fail-closed)", async () => {
    const user = await seedUser("issue-fail");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
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
    const failed = await flipMfa(
      completeLoginChallenge(challenge.headers, {
        code: await totpCode(enabled.secret),
        kind: "totp",
      }).pipe(Effect.provide(failingSessions)),
    );
    expect(failed).toBeInstanceOf(AuthApiError);

    // 消費済み fail-closed = 再ログイン導線 (成功扱いにすると session 無しの成功応答になる)。
    const after = await verify(challenge.headers, {
      code: await totpCode(enabled.secret, 1),
      kind: "totp",
    });
    expect(after).toEqual(expect.objectContaining({ ok: false, error: "challenge_expired" }));
  });
});
