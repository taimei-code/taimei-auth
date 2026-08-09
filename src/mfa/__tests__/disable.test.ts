import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { findUserById } from "@/db/repositories/user";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { disable } from "../disable";
import { enroll } from "../enroll";
import { clearTwoFactorEnabled } from "../gateway";
import {
  actorOf,
  ATTEMPT_BUDGET_ABSENT,
  attemptBudgetTtlSeconds,
  countLiveSessions,
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  findTwoFactorRow,
  installSentryRecorder,
  issuedSessionCookieCount,
  poisonAttemptBudget,
  secretFromTotpUri,
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

// src/mfa/disable-attempt-budget.ts の MAX_ATTEMPTS と同値。セキュリティ上の設計値なので、
// 実装から import せずテスト側に書き下ろして固定する。
const DISABLE_ATTEMPT_LIMIT = 5;

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

  test("登録しただけで未有効化のユーザー → not_enabled (有効化されない)", async () => {
    const user = await seedUser("unactivated");
    const session = await createSessionFor(user.id);
    const enrolled = await enroll(actorOf(user), session.headers);
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;

    // 前提条件が無いと、プラグインの verifyTOTP が「未 verified 行 + フラグ false」を有効化の
    // 合図と解釈し、無効化の要求がそのまま有効化として成立してしまう。
    const result = await disable({
      actor: actorOf(user),
      headers: session.headers,
      code: await totpCode(secretFromTotpUri(enrolled.totpUri)),
      kind: "totp",
    });

    expect(result).toEqual({ ok: false, error: "not_enabled", status: 409 });
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);
    expect((await findTwoFactorRow(user.id))?.verified).toBe(false);
    // 活性化はセッションを rotate して元のセッションを消す。残っていることが
    // 「コード検証に一切入らなかった」の観測値になる。
    expect(await countLiveSessions([session.token])).toBe(1);
    expect(await auditRowsFor(user.id, "mfa_disabled")).toEqual([]);
  });

  test("中断した無効化 (フラグのみ false) からの再 disable は通す", async () => {
    const user = await seedUser("halfdisabled");
    const enabled = await enableMfaFor(user);
    await clearTwoFactorEnabled(user.id);

    // enroll はこの状態を already_enabled で拒む。disable まで塞ぐと出口が運用救済しか無くなる。
    const result = await disable({
      actor: actorOf(user),
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(result.ok).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(0);
  });

  test("誤コード 5 回で以降は正しいコードでも locked", async () => {
    const user = await seedUser("lockout");
    const enabled = await enableMfaFor(user);
    const wrong = await wrongTotpCode(enabled.secret);

    const failures = [];
    for (let attempt = 0; attempt < DISABLE_ATTEMPT_LIMIT; attempt++) {
      failures.push(
        await disable({
          actor: enabled.actor,
          headers: enabled.session.headers,
          code: wrong,
          kind: "totp",
        }),
      );
    }

    expect(failures).toEqual(
      Array(DISABLE_ATTEMPT_LIMIT).fill({ ok: false, error: "invalid_code", status: 400 }),
    );

    // 上限の実効は「429 を返す」ことではなく、コード検証にすら入らないこと。正しいコードで
    // 拒まれることがその観測値になる。
    const afterLockout = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(afterLockout).toEqual({ ok: false, error: "locked", status: 429 });
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
    expect(await attemptBudgetTtlSeconds(user.id)).toBeGreaterThan(0);
  });

  test("リカバリーコードの誤りも同じ枠で数える", async () => {
    const user = await seedUser("lockout-mixed");
    const enabled = await enableMfaFor(user);

    for (let attempt = 0; attempt < DISABLE_ATTEMPT_LIMIT; attempt++) {
      await disable({
        actor: enabled.actor,
        headers: enabled.session.headers,
        code: attempt % 2 === 0 ? await wrongTotpCode(enabled.secret) : "aaaaa-bbbbb",
        kind: attempt % 2 === 0 ? "totp" : "recovery_code",
      });
    }

    // 種別ごとに枠を分けると、攻撃者は 2 倍の試行を得るだけで済む。
    const afterLockout = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    expect(afterLockout).toEqual({ ok: false, error: "locked", status: 429 });
  });

  test("検証に成功すると枠が戻る", async () => {
    const user = await seedUser("lockout-reset");
    const enabled = await enableMfaFor(user);
    const wrong = await wrongTotpCode(enabled.secret);

    for (let attempt = 0; attempt < DISABLE_ATTEMPT_LIMIT - 1; attempt++) {
      await disable({
        actor: enabled.actor,
        headers: enabled.session.headers,
        code: wrong,
        kind: "totp",
      });
    }

    const succeeded = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    expect(succeeded.ok).toBe(true);

    // 枠が残ったままだと、打ち間違えてから無効化・再登録した本人が次の無効化で即ロックされる。
    expect(await attemptBudgetTtlSeconds(user.id)).toBe(ATTEMPT_BUDGET_ABSENT);
  });

  test("counter を読めない時は正しいコードでも拒む (fail-closed)", async () => {
    const user = await seedUser("lockout-storage");
    const enabled = await enableMfaFor(user);
    await poisonAttemptBudget(user.id);

    const result = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });

    // Redis を落とすだけで第二要素の総当たり防御が消える状態を作らない。
    expect(result).toEqual({ ok: false, error: "locked", status: 429 });
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
    expect(sentry.exceptions.at(-1)?.context?.tags).toEqual({
      component: "mfa-disable-attempt-budget",
    });
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
