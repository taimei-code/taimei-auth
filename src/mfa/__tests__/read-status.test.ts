import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { findUserById } from "@/db/repositories/user";
import { twoFactor } from "@/db/schema";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import { disable } from "../disable";
import { readStatus } from "../read-status";
import {
  actorOf,
  countTwoFactorRows,
  createSessionFor,
  enableMfaFor,
  installSentryRecorder,
  totpCode,
} from "./helpers";

// read-status use-case (src/mfa/read-status.ts) の DB 統合テスト。
// 「フラグは true だが行は未 verified」という復帰不能状態は better-auth 側の 2 書き込みが
// 同一トランザクションに入らないことから実際に起こりうるため、検出と復帰の両方を固定する。

const P = "mfa-status-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

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
    expect(status.recoveryCodesRemaining).toBe(enabled.recoveryCodes.length);
    expect(status.recoveryCodesRemaining).toBe(10);
    expect(sentry.messages).toEqual([]);
  });

  test("MFA 未設定ユーザー → enabled:false, remaining:0 (残数問い合わせをしない)", async () => {
    const user = await seedUser("off");
    await createSessionFor(user.id);

    expect(await readStatus(actorOf(user))).toEqual({ enabled: false, recoveryCodesRemaining: 0 });
    expect(sentry.messages).toEqual([]);
  });

  test("QA-M-17 中間状態検出 Sentry", async () => {
    const user = await seedUser("m17");
    const enabled = await enableMfaFor(user);
    // 有効化の 2 書き込み (フラグ / verified) の間で中断した状態を作る。
    await db.update(twoFactor).set({ verified: false }).where(eq(twoFactor.userId, user.id));

    const status = await readStatus(enabled.actor);

    expect(status.enabled).toBe(true);
    expect(sentry.messages.length).toBe(1);
    expect(sentry.messages[0]?.message).toBe("mfa: enabled flag without verified two factor row");
    expect(sentry.messages[0]?.context?.level).toBe("error");
    expect(sentry.messages[0]?.context?.tags).toEqual({ component: "mfa-read-status" });
    expect(sentry.messages[0]?.context?.extra).toMatchObject({ userId: user.id, hasRow: true });

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
});
