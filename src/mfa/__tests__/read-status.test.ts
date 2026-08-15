import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findUserById } from "@/db/repositories/user";
import { twoFactor } from "@/db/schema";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { redisStorage } from "../../redis";
import { interruptedReportKey } from "../registration/status";
import {
  actorOf,
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  installSentryRecorder,
  MFA_ENROLLMENT_STATE_NAMES,
  seedMfaEnrollmentState,
  totpCode,
} from "./helpers";
import { disable, readStatus } from "./registration-production-harness";

// status use-case (src/mfa/registration/status.ts) の DB 統合テスト。
// 「中断した有効化」(フラグ true × 未 verified 行) は better-auth 側の 2 書き込みが
// 同一トランザクションに入らないことから実際に起こりうるため、検出と復帰の両方を固定する。

const P = "mfa-status-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

// 通報 throttle は user 単位・窓 6h。seed の user id は実行のたびに同じなので、通報を期待する
// テストは前回実行ぶんの窓を先に消す (attempt budget と同じ isolation)。
const freshReportWindow = (userId: string): Promise<void> =>
  redisStorage.delete(interruptedReportKey(userId));

describe("readStatus", () => {
  beforeEach(async () => {
    await cleanup();
    sentry.reset();
  });

  afterAll(async () => {
    await cleanup();
    sentry.restore();
  });

  test("QA-H-02 有効ユーザー → enabled:true, remaining:10", async () => {
    const user = await seedUser("h02");
    const enabled = await enableMfaFor(user);

    const status = await readStatus(enabled.actor);

    expect(status.enabled).toBe(true);
    expect(status.inEffect).toBe(true);
    expect(status.recoveryCodesRemaining).toBe(enabled.recoveryCodes.length);
    expect(status.recoveryCodesRemaining).toBe(10);
    expect(sentry.messages).toEqual([]);
  });

  test("MFA 未設定ユーザー → enabled:false, inEffect:false, remaining:0 (残数問い合わせをしない)", async () => {
    const user = await seedUser("off");
    await createSessionFor(user.id);

    expect(await readStatus(actorOf(user))).toEqual({
      enabled: false,
      inEffect: false,
      recoveryCodesRemaining: 0,
    });
    expect(sentry.messages).toEqual([]);
  });

  test("QA-M-17 中間状態検出 Sentry", async () => {
    const user = await seedUser("m17");
    const enabled = await enableMfaFor(user);
    // 有効化の 2 書き込み (フラグ / verified) の間で中断した状態を作る。
    await db.update(twoFactor).set({ verified: false }).where(eq(twoFactor.userId, user.id));
    await freshReportWindow(user.id);

    const status = await readStatus(enabled.actor);

    expect(status.enabled).toBe(true);
    expect(sentry.messages.length).toBe(1);
    expect(sentry.messages[0]?.message).toBe("mfa: enabled flag without verified two factor row");
    expect(sentry.messages[0]?.context?.level).toBe("error");
    expect(sentry.messages[0]?.context?.tags).toEqual({ component: "mfa-read-status" });
    expect(sentry.messages[0]?.context?.extra).toMatchObject({
      userId: user.id,
      enrollmentRecord: "unverified",
    });

    // 中間状態からの出口が disable であることが、この検出を「見て終わり」にしない根拠。
    const disabled = await disable({
      actor: enabled.actor,
      headers: enabled.session.headers,
      code: await totpCode(enabled.secret),
      kind: "totp",
    });
    expect(disabled.ok).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(0);
    expect((await findUserById(user.id))?.twoFactorEnabled).toBe(false);
  });

  test("QA-E-06 「中断した有効化 (行なし)」でも captureMessage は 1 件・captureException は出さない", async () => {
    const user = await seedUser("e06");
    const fx = await seedMfaEnrollmentState(user, "interruptedActivationNoRow");
    await freshReportWindow(user.id);

    const status = await readStatus(fx.actor);

    // 行なしでは残数取得 (viewBackupCodes) を呼ばないので gateway の captureException が
    // 自作の失敗で汚れない (item 4)。message 1 件のみ。
    expect(sentry.messages.length).toBe(1);
    expect(sentry.exceptions).toEqual([]);
    expect(sentry.messages[0]?.context?.extra).toMatchObject({
      userId: user.id,
      enrollmentRecord: "absent",
    });
    expect(status.enabled).toBe(true);
    expect(status.recoveryCodesRemaining).toBe(0);
  });

  test("QA-M-24 同一 user が滞留して再訪しても通報は窓ごとに 1 回に throttle される", async () => {
    const user = await seedUser("throttle");
    const fx = await seedMfaEnrollmentState(user, "interruptedActivationUnverified");
    await freshReportWindow(user.id);

    await readStatus(fx.actor);
    await readStatus(fx.actor);
    await readStatus(fx.actor);

    expect(sentry.messages.length).toBe(1);
  });

  test("QA-D-04 通報条件は「中断した有効化」の 2 サブ状態だけ — 他状態では出ない", async () => {
    const observed: Record<string, number> = {};
    for (const state of MFA_ENROLLMENT_STATE_NAMES) {
      const user = await seedUser(`d04-${state.toLowerCase()}`);
      const fx = await seedMfaEnrollmentState(user, state);
      await freshReportWindow(user.id);
      sentry.reset();
      await readStatus(fx.actor);
      observed[state] = sentry.messages.length;
    }

    expect(observed).toEqual({
      unregistered: 0,
      enrolledNotActivated: 0,
      active: 0,
      interruptedDisable: 0,
      interruptedActivationUnverified: 1,
      interruptedActivationNoRow: 1,
    });
  });
});
