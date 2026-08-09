import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { readChallenge } from "../challenge-store";
import { completeChallenge } from "../complete-challenge";
import {
  cleanupIssuedChallenges,
  enableMfaFor,
  issuedSessionCookieCount,
  issueTestChallenge,
  totpCode,
} from "./helpers";

// 同一チャレンジへの並行 verify。TOTP コードは検証窓の内側なら何度でも通るため、二重ログインを
// 止めているのは「チャレンジ状態の単回消費」だけ。ここが原子でないと 1 回のチャレンジから
// 複数セッションが生える。

const P = "mfa-race-";
const { cleanup, seedUser } = createSeedHelpers(P);

const CONCURRENT_SUBMITS = 4;

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

describe("並行 verify の単回消費", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  // flake 検知のため 5 回連続で同じ不変条件を要求する (membership.race.test.ts と同じ流儀)。
  for (let iteration = 1; iteration <= 5; iteration++) {
    test(`QA-M-22 並行 consume 1 回のみ (iteration ${iteration})`, async () => {
      const user = await seedUser(`it${iteration}`);
      const enabled = await enableMfaFor(user);
      const challenge = await issueTestChallenge({
        userId: user.id,
        redirectUrl: "/account",
        method: "magic_link",
      });
      const code = await totpCode(enabled.secret);

      const settled = await Promise.allSettled(
        Array.from({ length: CONCURRENT_SUBMITS }, () =>
          completeChallenge(challenge.headers, { code, kind: "totp" }),
        ),
      );

      const results = settled.map((outcome) => {
        expect(outcome.status).toBe("fulfilled");
        return outcome.status === "fulfilled" ? outcome.value : null;
      });
      const succeeded = results.filter((result) => result?.ok === true);
      expect(succeeded.length).toBe(1);

      const issuedCookies = await Promise.all(
        succeeded.map((result) =>
          result?.ok ? issuedSessionCookieCount(result.forwardedHeaders) : 0,
        ),
      );
      expect(issuedCookies).toEqual([1]);

      expect(await readChallenge(challenge.headers)).toEqual({ pending: false });
    });
  }
});
