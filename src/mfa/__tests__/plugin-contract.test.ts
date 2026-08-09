import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { readChallenge } from "../challenge-store";
import { verifyMfaCode } from "../gateway";
import {
  challengeAndSessionHeaders,
  cleanupIssuedChallenges,
  createSessionFor,
  enableMfaFor,
  findAttemptsIdentifier,
  findVerification,
  findTwoFactorRow,
  issuedSessionCookieCount,
  issueTestChallenge,
  requestHeaders,
  totpCode,
  wrongTotpCode,
} from "./helpers";

// better-auth twoFactor プラグインとの結合が壊れたことを PR 時点で捕まえるための tripwire。
// 自前で書いたチャレンジ状態をプラグイン本体の検証が消費できること、そして「セッションが
// 解決できるかどうか」で試行制限の有無が切り替わる分岐 (upstream の isSignIn) が維持されている
// ことの 2 点を見る。どちらも upstream の更新で silent に変わりうる前提で、変われば MFA の
// 総当たり防御が消える。
//
// 依存更新時の使い方: `bun test src/mfa && bun update better-auth && bun test src/mfa`

const P = "mfa-contract-";
const { cleanup, seedUser } = createSeedHelpers(P);

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

describe("twoFactor プラグインとの結合契約", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-M-08 challenge-store が書いた状態をプラグインの verify が消費する", async () => {
    const user = await seedUser("m08a");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });

    const verified = await verifyMfaCode(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    // cookie 名の導出・署名 scheme・verification key 形式のどれか 1 つでも食い違えば、
    // プラグインはチャレンジを解決できず新セッションを発行しない。
    expect(await issuedSessionCookieCount(verified.headers)).toBe(1);
    expect(await readChallenge(challenge.headers)).toEqual({ pending: false });
  });

  test("QA-M-08 セッション同梱では試行制限が働かない (isSignIn 分岐の維持)", async () => {
    const user = await seedUser("m08b");
    const enabled = await enableMfaFor(user);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });
    const withSession = await challengeAndSessionHeaders(challenge, enabled.session.token);
    const attemptsIdentifier = await findAttemptsIdentifier(challenge.challengeId);

    for (let attempt = 0; attempt < 6; attempt++) {
      const result = await verifyMfaCode(withSession, {
        code: await wrongTotpCode(enabled.secret),
        kind: "totp",
      });
      expect(result.ok).toBe(false);
    }

    // この経路が試行制限の対象外である事実が、complete-challenge が asPreSessionHeaders を
    // 必ず通す理由であり、セッションあり経路 (account-mfa) が自前 rate limit を持つ理由。
    const row = await findTwoFactorRow(user.id);
    expect(row?.failedVerificationCount).toBe(0);
    expect(row?.lockedUntil).toBeNull();
    expect((await findVerification(attemptsIdentifier))?.value).toBe("0");
    expect(await readChallenge(challenge.headers)).toMatchObject({ pending: true });
  });

  test("QA-M-11 プラグイン由来の失敗は自前エラー形に写像される", async () => {
    const user = await seedUser("m11");
    const enabled = await enableMfaFor(user);
    await createSessionFor(user.id);

    const noChallenge = await verifyMfaCode(requestHeaders(), {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    const wrongCode = await verifyMfaCode(enabled.session.headers, {
      code: await wrongTotpCode(enabled.secret),
      kind: "totp",
    });

    // TWO_FACTOR_ERROR_CODES の値は画面にも呼び出し側にも出さない契約。
    expect(noChallenge).toEqual({ ok: false, error: "challenge_expired", status: 401 });
    expect(wrongCode).toEqual({ ok: false, error: "invalid_code", status: 400 });
  });
});
