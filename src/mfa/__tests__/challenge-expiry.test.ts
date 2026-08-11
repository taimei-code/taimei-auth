import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { readChallenge } from "../challenge-store";
import { completeChallenge } from "../complete-challenge";
import {
  assertChallengeServedFromRedis,
  challengeMarkerRedisTtl,
  cleanupIssuedChallenges,
  enableMfaFor,
  issueTestChallenge,
  rewriteChallengeExpiry,
  totpCode,
  type IssuedChallenge,
} from "./helpers";

// 「Redis TTL は生きているが expiresAt は過去」という TTL とアプリ判定のずれの統合テスト
// (通常の TTL 失効はキーごと消え、消費済みと同じ経路に落ちる — それはここでは扱わない)。
// ADR-0013 が認可スモークに要求する 3 ケース (cookie 無し / 改ざん / 期限切れ) の 3 つ目。
// 期限切れと未期限切れを同一 builder の expiresAt 違いだけで作り、拒否が期限判定由来である
// ことを対照実験で示す。

const P = "mfa-expiry-";
const { cleanup, seedUser } = createSeedHelpers(P);

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

const challengeFor = (userId: string): Promise<IssuedChallenge> =>
  issueTestChallenge({ userId, redirectUrl: "/account", method: "magic_link" });

describe("チャレンジの期限判定", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-H-05 未期限切れチャレンジは pending:true のまま (対照実験)", async () => {
    const user = await seedUser("h05");
    const challenge = await challengeFor(user.id);
    const expiresAt = new Date(Date.now() + 300_000);
    await rewriteChallengeExpiry(challenge, expiresAt);
    await assertChallengeServedFromRedis(challenge, expiresAt);

    expect(await readChallenge(challenge.headers)).toEqual({
      pending: true,
      redirectUrl: "/account",
      method: "magic_link",
    });
  });

  test("QA-E-05 期限切れチャレンジは正しいコードでも challenge_expired / pending:false", async () => {
    const user = await seedUser("e05");
    const enabled = await enableMfaFor(user);
    const challenge = await challengeFor(user.id);
    const expiresAt = new Date(Date.now() - 60_000);
    await rewriteChallengeExpiry(challenge, expiresAt);
    await assertChallengeServedFromRedis(challenge, expiresAt);

    // 正しいコードで落ちることが「コードの正誤ではなく期限で落ちた」の観測値
    const result = await completeChallenge(challenge.headers, {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(result).toEqual({ ok: false, error: "challenge_expired", status: 401 });
    expect(await readChallenge(challenge.headers)).toEqual({ pending: false });
  });

  test("QA-D-03 Redis TTL 生存 × expiresAt 過去 は fail-closed に拒否される", async () => {
    const user = await seedUser("d03");
    const challenge = await challengeFor(user.id);
    await rewriteChallengeExpiry(challenge, new Date(Date.now() - 1_000));

    // TTL が -2 (キー消滅) なら通常の TTL 失効経路を見ていることになり、この境界のテストにならない
    expect(await challengeMarkerRedisTtl(challenge.challengeId)).toBeGreaterThan(0);
    expect(await readChallenge(challenge.headers)).toEqual({ pending: false });
  });
});
