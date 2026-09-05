import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { createSeedHelpers } from "../../../handlers/__tests__/helpers";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  findMfaTotpRow,
  installSentryRecorder,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "../../__tests__/helpers";
import type { AppServices } from "../../../runtime";
import {
  auditFailingLayer,
  disableBudgetLayer,
  issuerLayer,
  type MfaResult,
  notifierLayer,
  runMfaResult,
  sessionsLayer,
} from "../../__tests__/test-layers";
import { activate } from "../activate-mfa";
import { disable } from "../disable-mfa";
import { enroll } from "../enroll-mfa";
import { readOwnedMfaStatus } from "../read-status";
import { verifyAndConsumeOwnedCode } from "../verify-code";

// 登録遷移 use-case の統合テスト (実 DB + 記録型 test Layer)。評決表 (ADR-0016 §3.2) をそのまま固定する。
// revoke の実効性と Redis fail-closed は既存資産 (login-challenge / handler テスト) の担当。

const P = "mfa-totp-reg-";
const { cleanup, seedUser } = createSeedHelpers(P);
const sentry = installSentryRecorder();

const ISSUER = "taimei-test";

type Recorded = {
  revokes: Headers[];
  notified: string[];
  spends: string[];
  resets: string[];
};

type Ops = Recorded & {
  run<A, E>(program: Effect.Effect<A, E, AppServices>): Promise<MfaResult<A>>;
};

function buildOps(overrides?: { locked?: boolean; auditFails?: boolean }): Ops {
  const recorded: Recorded = { revokes: [], notified: [], spends: [], resets: [] };
  const layers = Layer.mergeAll(
    issuerLayer(ISSUER),
    sessionsLayer(recorded),
    notifierLayer(recorded.notified),
    disableBudgetLayer(recorded, overrides?.locked ?? false),
    ...(overrides?.auditFails ? [auditFailingLayer(new Error("audit store unavailable"))] : []),
  );
  return {
    ...recorded,
    run: (program) => runMfaResult(Effect.provide(program, layers)),
  };
}

const headers = new Headers({ "user-agent": "totp-reg-test", "x-forwarded-for": "203.0.113.9" });

describe("MFA 登録遷移 (自前 totp)", () => {
  beforeEach(async () => {
    await cleanup();
    sentry.reset();
  });
  afterAll(async () => {
    await cleanup();
    sentry.restore();
  });

  test("AC-102/103/104 未登録: status 全 false・activate 404・disable 409", async () => {
    const user = await seedUser("empty");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();

    expect(await ops.run(readOwnedMfaStatus(actor))).toEqual({
      ok: true,
      enabled: false,
      recoveryCodesRemaining: 0,
    });
    expect(
      await ops.run(activate({ actor, headers, enrollmentId: "no-enrollment", code: "123456" })),
    ).toEqual(expect.objectContaining({ ok: false, error: "not_found", status: 404 }));
    expect(await ops.run(disable({ actor, headers, code: "123456", kind: "totp" }))).toEqual(
      expect.objectContaining({ ok: false, error: "not_enabled", status: 409 }),
    );
    expect(await countMfaTotpRows(user.id)).toBe(0);
  });

  test("一巡: enroll → 再表示 → 評決 → activate → disable (ADR-0016 §3.2)", async () => {
    const user = await seedUser("cycle");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();

    // enroll
    const enrolled = await ops.run(enroll({ actor }));
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    expect(enrolled.totpUri.startsWith("otpauth://totp/")).toBe(true);
    expect(enrolled.totpUri).toContain(encodeURIComponent(ISSUER));
    expect(enrolled.recoveryCodes.length).toBe(10);
    expect(new Set(enrolled.recoveryCodes).size).toBe(10);
    for (const code of enrolled.recoveryCodes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect((await findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
    expect(await ops.run(readOwnedMfaStatus(actor))).toMatchObject({ enabled: false });

    // enroll 再実行 = 同一内容の再表示
    expect(await ops.run(enroll({ actor }))).toEqual(enrolled);

    // 識別子不一致 → 409 enrollment_changed
    const secret = secretFromTotpUri(enrolled.totpUri);
    const mismatch = await ops.run(
      activate({ actor, headers, enrollmentId: "stale-id", code: await totpCode(secret) }),
    );
    expect(mismatch).toEqual(
      expect.objectContaining({ ok: false, error: "enrollment_changed", status: 409 }),
    );

    // 誤コード → 400 かつ revoke 未呼出 (検証順序 — ADR-0016 §4.3)
    const wrong = await ops.run(
      activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: await wrongTotpCode(secret),
      }),
    );
    expect(wrong).toEqual(expect.objectContaining({ ok: false, error: "invalid_code" }));
    expect(ops.revokes.length).toBe(0);

    // 正コード (前 step) → 200
    const activated = await ops.run(
      activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: await totpCode(secret, -1),
      }),
    );
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.sessionChanges.getSetCookie()).toEqual(["revoked=stub"]);
    expect(ops.revokes.length).toBe(1);
    expect(ops.notified).toEqual([`enabled:${user.email}`]);
    expect((await findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
    expect(await ops.run(readOwnedMfaStatus(actor))).toEqual({
      ok: true,
      enabled: true,
      recoveryCodesRemaining: 10,
    });

    // 有効: enroll / activate → 409
    expect(await ops.run(enroll({ actor }))).toEqual(
      expect.objectContaining({ ok: false, error: "already_enabled" }),
    );
    expect(
      await ops.run(
        activate({
          actor,
          headers,
          enrollmentId: enrolled.enrollmentId,
          code: await totpCode(secret),
        }),
      ),
    ).toEqual(expect.objectContaining({ ok: false, error: "already_enabled" }));

    // kernel: 同一コード 2 回目はリプレイ拒否
    const code = await totpCode(secret);
    expect(await ops.run(verifyAndConsumeOwnedCode(user.id, { code, kind: "totp" }))).toEqual({
      ok: true,
    });
    expect(await ops.run(verifyAndConsumeOwnedCode(user.id, { code, kind: "totp" }))).toEqual({
      ok: false,
      error: "invalid_code",
      status: 400,
    });

    // disable (次 step のコード) → 200、両テーブル 0 行
    const disabled = await ops.run(
      disable({ actor, headers, code: await totpCode(secret, 1), kind: "totp" }),
    );
    expect(disabled.ok).toBe(true);
    expect(await countMfaTotpRows(user.id)).toBe(0);
    expect(await countRecoveryCodeRows(user.id)).toBe(0);
    expect(ops.notified).toEqual([`enabled:${user.email}`, `disabled:${user.email}`]);
    expect(ops.resets).toEqual([user.id]);
  });

  test("AC-121/122 リカバリーコードの消費と残数", async () => {
    const user = await seedUser("recovery");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();
    const enrolled = await ops.run(enroll({ actor }));
    if (!enrolled.ok) throw new Error("enroll failed");
    const secret = secretFromTotpUri(enrolled.totpUri);
    const activated = await ops.run(
      activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: await totpCode(secret, -1),
      }),
    );
    expect(activated.ok).toBe(true);

    const [first] = enrolled.recoveryCodes;
    expect(
      await ops.run(verifyAndConsumeOwnedCode(user.id, { code: first, kind: "recovery_code" })),
    ).toEqual({ ok: true });
    expect(
      await ops.run(verifyAndConsumeOwnedCode(user.id, { code: first, kind: "recovery_code" })),
    ).toEqual({ ok: false, error: "invalid_code", status: 400 });
    expect(await ops.run(readOwnedMfaStatus(actor))).toMatchObject({ recoveryCodesRemaining: 9 });

    // 並行消費 ×2 → 成功ちょうど 1
    const second = enrolled.recoveryCodes[1];
    const race = await Promise.all([
      ops.run(verifyAndConsumeOwnedCode(user.id, { code: second, kind: "recovery_code" })),
      ops.run(verifyAndConsumeOwnedCode(user.id, { code: second, kind: "recovery_code" })),
    ]);
    expect(race.filter((r) => r.ok).length).toBe(1);

    // 保有しないコード
    expect(
      await ops.run(
        verifyAndConsumeOwnedCode(user.id, { code: "zzzzz-zzzzz", kind: "recovery_code" }),
      ),
    ).toEqual({ ok: false, error: "invalid_code", status: 400 });
  });

  test("AC-116/117 disable の試行枠: 誤コードで budget 消費、枯渇で locked", async () => {
    const user = await seedUser("budget");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();
    const enrolled = await ops.run(enroll({ actor }));
    if (!enrolled.ok) throw new Error("enroll failed");
    const secret = secretFromTotpUri(enrolled.totpUri);
    await ops.run(
      activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: await totpCode(secret, -1),
      }),
    );

    const wrong = await ops.run(
      disable({ actor, headers, code: await wrongTotpCode(secret), kind: "totp" }),
    );
    expect(wrong).toEqual(expect.objectContaining({ ok: false, error: "invalid_code" }));
    expect(ops.spends).toEqual([user.id]);
    expect(await countMfaTotpRows(user.id)).toBe(1);

    // budget 枯渇 → locked (verify まで到達しない)
    const locked = buildOps({ locked: true });
    expect(
      await locked.run(disable({ actor, headers, code: await totpCode(secret), kind: "totp" })),
    ).toEqual(expect.objectContaining({ ok: false, error: "locked", status: 429 }));
    expect(await countMfaTotpRows(user.id)).toBe(1);

    // リカバリーコード kind でも disable できる
    const byRecovery = await ops.run(
      disable({ actor, headers, code: enrolled.recoveryCodes[0], kind: "recovery_code" }),
    );
    expect(byRecovery.ok).toBe(true);
    expect(await countMfaTotpRows(user.id)).toBe(0);
  });

  test("AC-157 audit 書込失敗でも操作は成功し Sentry で観測", async () => {
    const user = await seedUser("audit-fail");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps({ auditFails: true });
    const enrolled = await ops.run(enroll({ actor }));
    if (!enrolled.ok) throw new Error("enroll failed");
    const secret = secretFromTotpUri(enrolled.totpUri);

    const activated = await ops.run(
      activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: await totpCode(secret, -1),
      }),
    );

    expect(activated.ok).toBe(true);
    expect(sentry.exceptions.filter((e) => e.context?.tags?.component === "audit-log").length).toBe(
      1,
    );
    expect((await findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
  });

  test("AC-156 並行 enroll ×2 → 両応答が勝者の内容へ収束、DB は 1 行", async () => {
    const user = await seedUser("race-enroll");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();

    const [a, b] = await Promise.all([ops.run(enroll({ actor })), ops.run(enroll({ actor }))]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a).toEqual(b);
    expect(await countMfaTotpRows(user.id)).toBe(1);
    expect(await countRecoveryCodeRows(user.id)).toBe(10);
  });
});
