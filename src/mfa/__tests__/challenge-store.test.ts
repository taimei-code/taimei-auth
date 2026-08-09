import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { asPreSessionHeaders, consumeChallenge, readChallenge } from "../challenge-store";
import {
  challengeAndSessionHeaders,
  cleanupIssuedChallenges,
  createSessionFor,
  findChallengeIdentifiers,
  findVerification,
  issueTestChallenge,
  requestHeaders,
  signCookieValue,
  tamperCookieSignature,
} from "./helpers";

// challenge-store (src/mfa/challenge-store.ts) の Redis/DB 統合テスト。
// プラグイン内部形式との結合を封じている唯一のファイルなので、cookie と verification value の
// 対応が崩れていないかは実際に書いて読み直すことでしか確かめられない。

const P = "mfa-store-";
const { cleanup, seedUser } = createSeedHelpers(P);

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

describe("challenge-store", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-M-18 同時失効", async () => {
    const user = await seedUser("m18");
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });

    const identifiers = await findChallengeIdentifiers(challenge.challengeId);
    expect(identifiers.length).toBe(4);

    const cookieMaxAge = challenge.cookieMaxAgeSeconds;
    expect(typeof cookieMaxAge).toBe("number");

    // cookie と値のどちらかだけが生き残ると「cookie はあるのに状態が無い」中途半端な期限切れに
    // なるため、両辺とも観測値で突き合わせる (定数 600 を書くと片方の変更を検知できない)。
    for (const identifier of identifiers) {
      const stored = await findVerification(identifier);
      expect(stored).toBeDefined();
      const ttlSeconds = Math.round(
        ((stored as { expiresAt: Date }).expiresAt.getTime() - challenge.issuedAt) / 1000,
      );
      expect(ttlSeconds).toBe(cookieMaxAge as number);
    }
  });

  test("発行したチャレンジは redirect 先と一次認証手段つきで読み戻せる", async () => {
    const user = await seedUser("read");
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "https://app.example.com/dashboard",
      method: "github",
    });

    expect(await readChallenge(challenge.headers)).toEqual({
      pending: true,
      redirectUrl: "https://app.example.com/dashboard",
      method: "github",
    });
  });

  test("署名が一致しない cookie は pending:false (改ざんの成否を区別させない)", async () => {
    const user = await seedUser("tamper");
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });
    const tampered = tamperCookieSignature(await signCookieValue(challenge.challengeId));

    const state = await readChallenge(requestHeaders({ [challenge.cookieName]: tampered }));

    expect(state).toEqual({ pending: false });
  });

  test("consumeChallenge は自前の補助キーだけを消し、失効指示の cookie を返す", async () => {
    const user = await seedUser("consume");
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });

    const cleared = await consumeChallenge(challenge.headers);

    // 完了マーカーと試行カウンタはプラグインが消費するため、ここで消すと二重消費になる。
    const remaining = await findChallengeIdentifiers(challenge.challengeId);
    expect(remaining.length).toBe(2);
    expect(remaining).toContain(challenge.challengeId);

    const setCookies = cleared.getSetCookie();
    expect(setCookies.length).toBe(1);
    expect(setCookies[0]).toContain(`${challenge.cookieName}=`);
    expect(setCookies[0]).toContain("Max-Age=0");
  });

  test("asPreSessionHeaders はセッション cookie だけを落としチャレンジ cookie を残す", async () => {
    const user = await seedUser("presession");
    const session = await createSessionFor(user.id);
    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });
    const mixed = await challengeAndSessionHeaders(challenge, session.token);

    const preSession = await asPreSessionHeaders(mixed);

    const cookie = preSession.get("cookie") ?? "";
    expect(cookie).toContain(`${challenge.cookieName}=`);
    // セッションが解決できると試行制限もロックも丸ごと skip されるため、1 本の残留も許さない。
    expect(await readChallenge(preSession)).toMatchObject({ pending: true });
    expect(cookie.includes(session.token)).toBe(false);
  });
});
