import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { findUserById } from "@/db/repositories/user";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { completeChallenge } from "../complete-challenge";
import {
  actorOf,
  cleanupIssuedChallenges,
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  findTwoFactorRow,
  issuedSessionCookieCount,
  issueTestChallenge,
  requestHeaders,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "./helpers";
import { activate, disable, enroll, readStatus } from "./registration-production-harness";

// MFA の不変条件。個々の use-case テストが「その操作の結果」を見るのに対し、ここは操作を
// またいで成立し続けるべき性質だけを見る。policy.ts が two_factor 行を読まずに user の 1 フラグで
// チャレンジ要否を決められる根拠そのものなので、崩れるとログイン経路が丸ごと嘘になる。

const P = "mfa-invariant-";
const { cleanup, seedUser } = createSeedHelpers(P);

const cleanupAll = async (): Promise<void> => {
  await cleanupIssuedChallenges();
  await cleanup();
};

describe("MFA の不変条件", () => {
  beforeEach(cleanupAll);
  afterAll(cleanupAll);

  test("QA-I-01 enabled ⇔ verified 行 1 件", async () => {
    const user = await seedUser("i01");
    const session = await createSessionFor(user.id);

    const flagAndRow = async (): Promise<{
      enabled: boolean | undefined;
      verified: boolean | undefined;
      rows: number;
    }> => ({
      enabled: (await findUserById(user.id))?.twoFactorEnabled,
      verified: (await findTwoFactorRow(user.id))?.verified,
      rows: await countTwoFactorRows(user.id),
    });

    expect(await flagAndRow()).toEqual({ enabled: false, verified: undefined, rows: 0 });

    const enrolled = await enroll(actorOf(user), session.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    // 登録しただけの段階でフラグが立つと、認証アプリ未登録のままログインが締め出される。
    expect(await flagAndRow()).toEqual({ enabled: false, verified: false, rows: 1 });

    const activated = await activate({
      actor: actorOf(user),
      headers: session.headers,
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(await flagAndRow()).toEqual({ enabled: true, verified: true, rows: 1 });

    const enabledActor = actorOf(user, { twoFactorEnabled: true });
    const disabled = await disable({
      actor: enabledActor,
      headers: await createSessionFor(user.id).then((s) => s.headers),
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
      kind: "totp",
    });
    expect(disabled.ok).toBe(true);
    expect(await flagAndRow()).toEqual({ enabled: false, verified: undefined, rows: 0 });
  });

  test("QA-I-02 secret/backup_codes 不変", async () => {
    const user = await seedUser("i02");
    const enabled = await enableMfaFor(user);
    const before = await findTwoFactorRow(user.id);

    // 有効期間中に通る読み取り・失敗・TOTP 検証を一通り通す。
    await readStatus(enabled.actor);
    expect(
      await disable({
        actor: enabled.actor,
        headers: enabled.session.headers,
        code: await wrongTotpCode(enabled.secret),
        kind: "totp",
      }),
    ).toEqual({ ok: false, error: "invalid_code", status: 400 });

    const challenge = await issueTestChallenge({
      userId: user.id,
      redirectUrl: "/account",
      method: "magic_link",
    });
    expect(
      (
        await completeChallenge(challenge.headers, {
          code: await totpCode(enabled.secret),
          kind: "totp",
        })
      ).ok,
    ).toBe(true);

    const after = await findTwoFactorRow(user.id);
    // secret が動くと手元の認証アプリが黙って通らなくなる。リカバリーコードは単回使用の消費
    // (recovery_code 経路) 以外では動かない。
    expect(after?.secret).toBe(before?.secret as string);
    expect(after?.backupCodes).toBe(before?.backupCodes as string);
    expect(after?.id).toBe(before?.id as string);
  });

  test("QA-I-03 cookie 本数 == 成功時のみ 1", async () => {
    const user = await seedUser("i03");
    const enabled = await enableMfaFor(user);

    const succeeded = await completeChallenge(
      await issueTestChallenge({
        userId: user.id,
        redirectUrl: "/account",
        method: "magic_link",
      }).then((c) => c.headers),
      { code: await totpCode(enabled.secret), kind: "totp" },
    );
    const wrongCode = await completeChallenge(
      await issueTestChallenge({
        userId: user.id,
        redirectUrl: "/account",
        method: "magic_link",
      }).then((c) => c.headers),
      { code: await wrongTotpCode(enabled.secret), kind: "totp" },
    );
    const withoutChallenge = await completeChallenge(requestHeaders(), {
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    const rejectedDisable = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await wrongTotpCode(enabled.secret),
      kind: "totp",
    });

    const issuedCookies = await Promise.all([
      succeeded.ok ? issuedSessionCookieCount(succeeded.forwardedHeaders) : 0,
      wrongCode.ok ? issuedSessionCookieCount(wrongCode.forwardedHeaders) : 0,
      withoutChallenge.ok ? issuedSessionCookieCount(withoutChallenge.forwardedHeaders) : 0,
      rejectedDisable.ok ? issuedSessionCookieCount(rejectedDisable.sessionChanges) : 0,
    ]);

    expect(issuedCookies).toEqual([1, 0, 0, 0]);
  });
});
