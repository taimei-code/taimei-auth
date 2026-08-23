import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readRegistrationSnapshot } from "@/db/repositories/mfa-registration";
import { findUserById } from "@/db/repositories/user";
import { auditRowsFor, createSeedHelpers } from "../../handlers/__tests__/helpers";
import { forceDisableMfa } from "../registration/force-disable";
import {
  countTwoFactorRows,
  enableMfaFor,
  installSentryRecorder,
  withFailingAuditWrite,
} from "./helpers";

// force-disable use-case (src/mfa/registration/force-disable.ts) の DB 統合テスト。
// 認証アプリとリカバリーコードを両方失ったユーザーの唯一の出口なので、「解除された」だけでなく
// 「解除後に本人が再登録できる状態 (行なし + フラグ false) に着地する」ことまで固定する。

const P = "mfa-force-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

describe("forceDisableMfa", () => {
  beforeEach(async () => {
    await cleanup();
    sentry.reset();
  });

  afterAll(async () => {
    await cleanup();
    sentry.restore();
  });

  test("QA-M-04 userId 指定で無効化", async () => {
    const user = await seedUser("m04");
    await enableMfaFor(user);

    const result = await forceDisableMfa(user.id, await readRegistrationSnapshot(user.id));

    expect(result).toEqual({ ok: true, changed: true, notifyEmail: user.email });
    expect(await countTwoFactorRows(user.id)).toBe(0);
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);

    const audits = await auditRowsFor(user.id, "mfa_disabled");
    expect(audits.length).toBe(1);
    // リクエストが無い経路なので ip は null。"unknown" を入れると「本人操作だが IP 不明」と
    // 区別できなくなるため、実行元はこの userAgent が示す。
    expect(audits[0]?.payload).toEqual({ ip: null, userAgent: "management/disable-user-mfa" });
  });

  test("QA-M-04 存在しない userId → not_found (副作用なし)", async () => {
    const result = await forceDisableMfa(`${P}missing`, { user: "absent" });

    expect(result).toEqual({ ok: false, error: "not_found", status: 404 });
    expect(await auditRowsFor(`${P}missing`, "mfa_disabled")).toEqual([]);
  });

  test("QA-M-04 MFA 未設定ユーザー → 冪等 (changed:false / audit なし)", async () => {
    const user = await seedUser("idempotent");

    const first = await forceDisableMfa(user.id, await readRegistrationSnapshot(user.id));
    const second = await forceDisableMfa(user.id, await readRegistrationSnapshot(user.id));

    expect(first).toEqual({ ok: true, changed: false });
    expect(second).toEqual({ ok: true, changed: false });
    expect(await auditRowsFor(user.id, "mfa_disabled")).toEqual([]);
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);
  });

  test("audit 記帳が落ちても通知宛先まで到達する", async () => {
    const user = await seedUser("auditdown");
    await enableMfaFor(user);

    const result = await withFailingAuditWrite(async () =>
      forceDisableMfa(user.id, await readRegistrationSnapshot(user.id)),
    );

    // 記帳失敗で CLI が止まると、解除済みなので再実行は changed:false に落ち、
    // 本人が「知らないうちに MFA が外れた」ことに気づく唯一の信号 (通知メール) が永久に消える。
    expect(result).toEqual({ ok: true, changed: true, notifyEmail: user.email });
    expect(await countTwoFactorRows(user.id)).toBe(0);
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);

    expect(await auditRowsFor(user.id, "mfa_disabled")).toEqual([]);
    expect(sentry.exceptions.length).toBe(1);
    expect(sentry.exceptions[0]?.context?.tags).toEqual({
      component: "audit-log",
      event: "mfa_disabled",
    });
  });
});
