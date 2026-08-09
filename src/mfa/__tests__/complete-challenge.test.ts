import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { auth } from "../../auth";
import { readChallenge } from "../challenge-store";
import { completeChallenge } from "../complete-challenge";
import { countRemainingRecoveryCodes } from "../gateway";
import {
  cleanupIssuedChallenges,
  deleteVerification,
  enableMfaFor,
  findAttemptsIdentifier,
  installSentryRecorder,
  issuedSessionCookieCount,
  issueTestChallenge,
  totpCode,
  wrongTotpCode,
  type EnabledMfaUser,
  type IssuedChallenge,
} from "./helpers";

// completeChallenge use-case (src/mfa/complete-challenge.ts) の DB/Redis 統合テスト。
// セッション無し経路に載っていることが試行制限の前提なので、失敗回数の効き方まで含めて固定する
// (セッションが 1 本混ざるだけでプラグインは試行カウントもロックも skip する)。

const P = "mfa-complete-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

const challengeFor = (userId: string): Promise<IssuedChallenge> =>
  issueTestChallenge({ userId, redirectUrl: "/account", method: "magic_link" });

const failOnce = (challenge: IssuedChallenge, enabled: EnabledMfaUser) =>
  wrongTotpCode(enabled.secret).then((code) =>
    completeChallenge(challenge.headers, { code, kind: "totp" }),
  );

describe("completeChallenge", () => {
  beforeEach(async () => {
    await cleanupAll();
    sentry.reset();
  });

  afterAll(async () => {
    await cleanupAll();
    sentry.restore();
  });

  test("QA-H-05 リカバリーコード成功 → 残数 1 減", async () => {
    const user = await seedUser("h05");
    const enabled = await enableMfaFor(user);
    const before = await countRemainingRecoveryCodes(enabled.actor);
    const challenge = await challengeFor(user.id);

    const result = await completeChallenge(challenge.headers, {
      code: enabled.recoveryCodes[0],
      kind: "recovery_code",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirectUrl).toBe("/account");
    expect(await issuedSessionCookieCount(result.forwardedHeaders)).toBe(1);
    expect(await countRemainingRecoveryCodes(enabled.actor)).toBe(before - 1);
  });

  test("QA-E-06 10 回失敗 → locked/429", async () => {
    const user = await seedUser("e06");
    const enabled = await enableMfaFor(user);

    // 1 チャレンジで使える失敗は 5 回まで。アカウント単位の budget (10 回) はチャレンジを
    // またいで積み上がる、というのがロックの成立条件そのもの。
    for (const challenge of [await challengeFor(user.id), await challengeFor(user.id)]) {
      for (let attempt = 0; attempt < 5; attempt++) {
        expect(await failOnce(challenge, enabled)).toEqual({
          ok: false,
          error: "invalid_code",
          status: 400,
        });
      }
    }

    const locked = await completeChallenge(await challengeFor(user.id).then((c) => c.headers), {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(locked).toEqual({ ok: false, error: "locked", status: 429 });
    const lockReports = sentry.messages.filter(
      (capture) => capture.context?.tags?.pluginCode === "ACCOUNT_TEMPORARILY_LOCKED",
    );
    expect(lockReports.length).toBe(1);
    expect(lockReports[0]?.message).toBe("mfa: verification attempt budget exhausted");
    expect(lockReports[0]?.context?.level).toBe("warning");
  });

  test("QA-D-03 2 連続 verify → 1 本目のみ", async () => {
    const user = await seedUser("d03");
    const enabled = await enableMfaFor(user);
    const challenge = await challengeFor(user.id);
    const code = await totpCode(enabled.secret);

    const first = await completeChallenge(challenge.headers, { code, kind: "totp" });
    const second = await completeChallenge(challenge.headers, { code, kind: "totp" });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await issuedSessionCookieCount(first.forwardedHeaders)).toBe(1);
    // 同じコードは検証窓の内側で何度でも通るため、2 本目を止めているのはチャレンジの単回消費。
    expect(second).toEqual({ ok: false, error: "challenge_expired", status: 401 });
  });

  test("QA-D-04 5 回失敗 → 破棄", async () => {
    const user = await seedUser("d04");
    const enabled = await enableMfaFor(user);
    const challenge = await challengeFor(user.id);

    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await failOnce(challenge, enabled)).toEqual({
        ok: false,
        error: "invalid_code",
        status: 400,
      });
    }

    // 6 回目は正しいコードでも通らない。ここで破棄されるので打ち直しの導線を出してはいけない。
    const withCorrectCode = await completeChallenge(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    expect(withCorrectCode.ok).toBe(false);

    expect(await readChallenge(challenge.headers)).toEqual({ pending: false });
    expect(
      await completeChallenge(challenge.headers, {
        code: await totpCode(enabled.secret),
        kind: "totp",
      }),
    ).toEqual({ ok: false, error: "challenge_expired", status: 401 });
  });

  test("QA-M-19 attempts 喪失 → 縮退", async () => {
    const user = await seedUser("m19");
    const enabled = await enableMfaFor(user);
    const challenge = await challengeFor(user.id);
    await deleteVerification(await findAttemptsIdentifier(challenge.challengeId));

    // 試行カウンタを欠いたまま検証を通すと 5 回制限が消えるため、正しいコードでも成立させない。
    const result = await completeChallenge(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(result).toEqual({ ok: false, error: "challenge_expired", status: 401 });
  });

  test("QA-M-21 使用済み再利用拒否", async () => {
    const user = await seedUser("m21");
    const enabled = await enableMfaFor(user);
    const usedCode = enabled.recoveryCodes[0];

    const first = await completeChallenge(await challengeFor(user.id).then((c) => c.headers), {
      code: usedCode,
      kind: "recovery_code",
    });
    expect(first.ok).toBe(true);
    const remainingAfterUse = await countRemainingRecoveryCodes(enabled.actor);

    const reused = await completeChallenge(await challengeFor(user.id).then((c) => c.headers), {
      code: usedCode,
      kind: "recovery_code",
    });

    expect(reused).toEqual({ ok: false, error: "invalid_code", status: 400 });
    expect(await countRemainingRecoveryCodes(enabled.actor)).toBe(remainingAfterUse);
  });

  test("補助キーの後始末が落ちてもセッションは発行される", async () => {
    const user = await seedUser("cleanupdown");
    const enabled = await enableMfaFor(user);
    const challenge = await challengeFor(user.id);
    const { internalAdapter } = await auth.$context;
    const deleteByIdentifier = internalAdapter.deleteVerificationByIdentifier.bind(internalAdapter);
    // 落とすのは challenge-store が所有する補助キーだけ。プラグイン自身の消費まで潰すと
    // 「検証が失敗した」を観測することになり、後始末の失敗を見たことにならない。
    const failing = spyOn(internalAdapter, "deleteVerificationByIdentifier").mockImplementation(
      (identifier: string) =>
        identifier.startsWith("mfa-")
          ? Promise.reject(new Error("challenge store unavailable"))
          : deleteByIdentifier(identifier),
    );

    try {
      const result = await completeChallenge(challenge.headers, {
        code: await totpCode(enabled.secret),
        kind: "totp",
      });

      // 後始末を伝播させると、プラグインは完了マーカーを消費済みなのに Set-Cookie が転送されず、
      // 「チャレンジは使い切ったのにセッションも無い」= 再ログインもできない袋小路になる。
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.redirectUrl).toBe("/account");
      expect(await issuedSessionCookieCount(result.forwardedHeaders)).toBe(1);
      expect(sentry.exceptions.length).toBe(1);
      expect(sentry.exceptions[0]?.context?.tags).toEqual({ component: "mfa-complete-challenge" });
    } finally {
      failing.mockRestore();
    }
  });
});
