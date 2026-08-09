import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { findUserById } from "@/db/repositories/user";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { disable } from "../disable";
import {
  countLiveSessions,
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  findTwoFactorRow,
  installSentryRecorder,
  issuedSessionCookieCount,
  TEST_CLIENT_IP,
  TEST_USER_AGENT,
  totpCode,
  withFailingAuditWrite,
  wrongTotpCode,
} from "./helpers";

// disable use-case (src/mfa/disable.ts) の DB/Redis 統合テスト。
// 本人確認を先頭に置く契約は「誤コードで 400」ではなく「誤コードで何も動かない」ことでしか
// 確認できないため、副作用の観測は操作前後の突き合わせで行う。

const P = "mfa-disable-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

describe("disable", () => {
  beforeEach(async () => {
    await cleanup();
    sentry.reset();
  });

  afterAll(async () => {
    await cleanup();
    sentry.restore();
  });

  test("QA-M-01 mfa_disabled audit 1 + メール", async () => {
    const user = await seedUser("m01");
    const enabled = await enableMfaFor(user);

    const result = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifyEmail).toBe(user.email);
    expect(await issuedSessionCookieCount(result.forwardedHeaders)).toBe(1);

    const audits = await auditRowsFor(user.id, "mfa_disabled");
    expect(audits.length).toBe(1);
    // 監査ログ閲覧を第二要素の漏洩経路にしないため、payload の key set 自体を固定する。
    expect(audits[0]?.payload).toEqual({ ip: TEST_CLIENT_IP, userAgent: TEST_USER_AGENT });

    expect(await countTwoFactorRows(user.id)).toBe(0);
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);
  });

  test("QA-E-03 誤コード → 400 副作用なし", async () => {
    const user = await seedUser("e03");
    const enabled = await enableMfaFor(user);
    const otherDevice = await createSessionFor(user.id);

    const before = {
      row: await findTwoFactorRow(user.id),
      liveSessions: await countLiveSessions([enabled.session.token, otherDevice.token]),
    };

    const result = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await wrongTotpCode(enabled.secret),
      kind: "totp",
    });

    expect(result).toEqual({ ok: false, error: "invalid_code", status: 400 });

    const after = {
      row: await findTwoFactorRow(user.id),
      liveSessions: await countLiveSessions([enabled.session.token, otherDevice.token]),
    };
    expect(after.row?.secret).toBe(before.row?.secret as string);
    expect(after.row?.backupCodes).toBe(before.row?.backupCodes as string);
    expect(after.row?.verified).toBe(true);
    // revoke も rotate も走っていないこと。走っていれば「誤コードでも他端末が落ちる」になる。
    expect(after.liveSessions).toBe(before.liveSessions);
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(true);
    expect(await auditRowsFor(user.id, "mfa_disabled")).toEqual([]);
  });

  test("audit 記帳が落ちても無効化は完走する", async () => {
    const user = await seedUser("auditdown");
    const enabled = await enableMfaFor(user);
    const code = await totpCode(enabled.secret);

    const result = await withFailingAuditWrite(() =>
      disable({ actor: enabled.actor, headers: enabled.session.headers, code, kind: "totp" }),
    );

    // 無効化は済んでいるので、記帳失敗を伝播させても取り消せない。伝播させると Set-Cookie が
    // 転送されず本人が今のデバイスから落ち、通知メールの宛先も返らないぶん状況が悪化する。
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifyEmail).toBe(user.email);
    expect(await issuedSessionCookieCount(result.forwardedHeaders)).toBe(1);
    expect(await countTwoFactorRows(user.id)).toBe(0);

    expect(await auditRowsFor(user.id, "mfa_disabled")).toEqual([]);
    expect(sentry.exceptions.length).toBe(1);
    expect(sentry.exceptions[0]?.context?.tags).toEqual({
      component: "audit-log",
      event: "mfa_disabled",
    });
  });
});
