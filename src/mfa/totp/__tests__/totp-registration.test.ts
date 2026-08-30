import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createSeedHelpers } from "../../../handlers/__tests__/helpers";
import { failure, LOCKED, type MfaFailure } from "../../error-mapping";
import {
  countMfaTotpRows,
  countRecoveryCodeRows,
  findMfaTotpRow,
  secretFromTotpUri,
  totpCode,
  wrongTotpCode,
} from "../../__tests__/helpers";
import { createMfaActivation } from "../activate-mfa";
import { parseMfaKeyRing } from "../cipher";
import { createMfaDisable } from "../disable-mfa";
import { createMfaEnrollment } from "../enroll-mfa";
import { readOwnedMfaStatus } from "../read-status";
import { verifyAndConsumeOwnedCode } from "../verify-code";

// 登録遷移 use-case の統合テスト (実 DB + 記録型 stub)。評決表 (ADR-0016 §3.2) をそのまま固定する。
// revoke の実効性と Redis fail-closed は既存資産 (login-challenge / handler テスト) の担当。

const P = "mfa-totp-reg-";
const { cleanup, seedUser } = createSeedHelpers(P);

const ring = () => parseMfaKeyRing(process.env.MFA_TOTP_ENCRYPTION_KEYS);
const ISSUER = "taimei-test";

type Recorded = {
  revokes: Headers[];
  audits: { userId: string; ip: string | null; userAgent: string }[];
  auditErrors: unknown[];
  notified: string[];
  spends: string[];
  resets: string[];
};

function buildOps(overrides?: { spendResult?: MfaFailure; auditFails?: boolean }): Recorded & {
  enroll: ReturnType<typeof createMfaEnrollment>;
  activate: ReturnType<typeof createMfaActivation>;
  disable: ReturnType<typeof createMfaDisable>;
} {
  const recorded: Recorded = {
    revokes: [],
    audits: [],
    auditErrors: [],
    notified: [],
    spends: [],
    resets: [],
  };
  const sessions = {
    revokeOthers: async (headers: Headers) => {
      recorded.revokes.push(headers);
      const stub = new Headers();
      stub.append("set-cookie", "revoked=stub");
      return { ok: true as const, headers: stub };
    },
  };
  const writeAudit = (input: { userId: string; ip: string | null; userAgent: string }) => {
    if (overrides?.auditFails) return Promise.reject(new Error("audit store unavailable"));
    recorded.audits.push(input);
    return Promise.resolve();
  };
  const observeAuditError = (error: unknown) => recorded.auditErrors.push(error);
  return {
    ...recorded,
    enroll: createMfaEnrollment({ ring, issuer: () => ISSUER }),
    activate: createMfaActivation({
      ring,
      sessions,
      writeAudit,
      observeAuditError,
      notifyEnabled: (email) => recorded.notified.push(`enabled:${email}`),
    }),
    disable: createMfaDisable({
      ring,
      sessions,
      writeAudit,
      observeAuditError,
      notifyDisabled: (email) => recorded.notified.push(`disabled:${email}`),
      spendAttempt: async (userId) => {
        recorded.spends.push(userId);
        return overrides?.spendResult;
      },
      resetAttempts: async (userId) => {
        recorded.resets.push(userId);
      },
    }),
  };
}

const headers = new Headers({ "user-agent": "totp-reg-test", "x-forwarded-for": "203.0.113.9" });

describe("MFA 登録遷移 (自前 totp)", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("AC-102/103/104 未登録: status 全 false・activate 404・disable 409", async () => {
    const user = await seedUser("empty");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();

    expect(await readOwnedMfaStatus(actor)).toEqual({
      enabled: false,
      recoveryCodesRemaining: 0,
    });
    expect(
      await ops.activate({ actor, headers, enrollmentId: "no-enrollment", code: "123456" }),
    ).toEqual(expect.objectContaining({ ok: false, error: "not_found", status: 404 }));
    expect(await ops.disable({ actor, headers, code: "123456", kind: "totp" })).toEqual(
      expect.objectContaining({ ok: false, error: "not_enabled", status: 409 }),
    );
    expect(await countMfaTotpRows(user.id)).toBe(0);
  });

  test("一巡: enroll → 再表示 → 評決 → activate → disable (ADR-0016 §3.2)", async () => {
    const user = await seedUser("cycle");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();

    // enroll
    const enrolled = await ops.enroll({ actor });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    expect(enrolled.totpUri.startsWith("otpauth://totp/")).toBe(true);
    expect(enrolled.totpUri).toContain(encodeURIComponent(ISSUER));
    expect(enrolled.recoveryCodes.length).toBe(10);
    expect(new Set(enrolled.recoveryCodes).size).toBe(10);
    for (const code of enrolled.recoveryCodes) expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect((await findMfaTotpRow(user.id))?.verifiedAt).toBeNull();
    expect((await readOwnedMfaStatus(actor)).enabled).toBe(false);

    // enroll 再実行 = 同一内容の再表示
    const replayed = await ops.enroll({ actor });
    expect(replayed).toEqual(enrolled);

    // 識別子不一致 → 409 enrollment_changed
    const secret = secretFromTotpUri(enrolled.totpUri);
    const mismatch = await ops.activate({
      actor,
      headers,
      enrollmentId: "stale-id",
      code: await totpCode(secret),
    });
    expect(mismatch).toEqual(
      expect.objectContaining({ ok: false, error: "enrollment_changed", status: 409 }),
    );

    // 誤コード → 400 かつ revoke 未呼出 (検証順序 — ADR-0016 §4.3)
    const wrong = await ops.activate({
      actor,
      headers,
      enrollmentId: enrolled.enrollmentId,
      code: await wrongTotpCode(secret),
    });
    expect(wrong).toEqual(expect.objectContaining({ ok: false, error: "invalid_code" }));
    expect(ops.revokes.length).toBe(0);

    // 正コード (前 step) → 200
    const activated = await ops.activate({
      actor,
      headers,
      enrollmentId: enrolled.enrollmentId,
      code: await totpCode(secret, -1),
    });
    expect(activated.ok).toBe(true);
    if (!activated.ok) return;
    expect(activated.sessionChanges.getSetCookie()).toEqual(["revoked=stub"]);
    expect(ops.revokes.length).toBe(1);
    expect(ops.audits).toEqual([
      { userId: user.id, ip: "203.0.113.9", userAgent: "totp-reg-test" },
    ]);
    expect(ops.notified).toEqual([`enabled:${user.email}`]);
    expect((await findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
    expect(await readOwnedMfaStatus(actor)).toEqual({
      enabled: true,
      recoveryCodesRemaining: 10,
    });

    // 有効: enroll / activate → 409
    expect(await ops.enroll({ actor })).toEqual(
      expect.objectContaining({ ok: false, error: "already_enabled" }),
    );
    expect(
      await ops.activate({
        actor,
        headers,
        enrollmentId: enrolled.enrollmentId,
        code: await totpCode(secret),
      }),
    ).toEqual(expect.objectContaining({ ok: false, error: "already_enabled" }));

    // kernel: 同一コード 2 回目はリプレイ拒否
    const code = await totpCode(secret);
    expect(
      await verifyAndConsumeOwnedCode(ring(), user.id, { code, kind: "totp" }),
    ).toBeUndefined();
    expect(await verifyAndConsumeOwnedCode(ring(), user.id, { code, kind: "totp" })).toEqual(
      failure({ error: "invalid_code", status: 400 }),
    );

    // disable (次 step のコード) → 200、両テーブル 0 行
    const disabled = await ops.disable({
      actor,
      headers,
      code: await totpCode(secret, 1),
      kind: "totp",
    });
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
    const enrolled = await ops.enroll({ actor });
    if (!enrolled.ok) throw new Error("enroll failed");
    const secret = secretFromTotpUri(enrolled.totpUri);
    const activated = await ops.activate({
      actor,
      headers,
      enrollmentId: enrolled.enrollmentId,
      code: await totpCode(secret, -1),
    });
    expect(activated.ok).toBe(true);

    const [first] = enrolled.recoveryCodes;
    expect(
      await verifyAndConsumeOwnedCode(ring(), user.id, { code: first, kind: "recovery_code" }),
    ).toBeUndefined();
    expect(
      await verifyAndConsumeOwnedCode(ring(), user.id, { code: first, kind: "recovery_code" }),
    ).toEqual(failure({ error: "invalid_code", status: 400 }));
    expect((await readOwnedMfaStatus(actor)).recoveryCodesRemaining).toBe(9);

    // 並行消費 ×2 → 成功ちょうど 1
    const second = enrolled.recoveryCodes[1];
    const race = await Promise.all([
      verifyAndConsumeOwnedCode(ring(), user.id, { code: second, kind: "recovery_code" }),
      verifyAndConsumeOwnedCode(ring(), user.id, { code: second, kind: "recovery_code" }),
    ]);
    expect(race.filter((r) => r === undefined).length).toBe(1);

    // 保有しないコード
    expect(
      await verifyAndConsumeOwnedCode(ring(), user.id, {
        code: "zzzzz-zzzzz",
        kind: "recovery_code",
      }),
    ).toEqual(failure({ error: "invalid_code", status: 400 }));
  });

  test("AC-116/117 disable の試行枠: 誤コードで budget 消費、枯渇で locked", async () => {
    const user = await seedUser("budget");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();
    const enrolled = await ops.enroll({ actor });
    if (!enrolled.ok) throw new Error("enroll failed");
    const secret = secretFromTotpUri(enrolled.totpUri);
    await ops.activate({
      actor,
      headers,
      enrollmentId: enrolled.enrollmentId,
      code: await totpCode(secret, -1),
    });

    const wrong = await ops.disable({
      actor,
      headers,
      code: await wrongTotpCode(secret),
      kind: "totp",
    });
    expect(wrong).toEqual(expect.objectContaining({ ok: false, error: "invalid_code" }));
    expect(ops.spends).toEqual([user.id]);
    expect(await countMfaTotpRows(user.id)).toBe(1);

    // budget 枯渇 stub → locked (verify まで到達しない)
    const locked = buildOps({ spendResult: failure(LOCKED) });
    expect(
      await locked.disable({ actor, headers, code: await totpCode(secret), kind: "totp" }),
    ).toEqual(expect.objectContaining({ ok: false, error: "locked", status: 429 }));
    expect(await countMfaTotpRows(user.id)).toBe(1);

    // リカバリーコード kind でも disable できる
    const byRecovery = await ops.disable({
      actor,
      headers,
      code: enrolled.recoveryCodes[0],
      kind: "recovery_code",
    });
    expect(byRecovery.ok).toBe(true);
    expect(await countMfaTotpRows(user.id)).toBe(0);
  });

  test("AC-157 audit 書込失敗でも操作は成功し observeAuditError で観測", async () => {
    const user = await seedUser("audit-fail");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps({ auditFails: true });
    const enrolled = await ops.enroll({ actor });
    if (!enrolled.ok) throw new Error("enroll failed");
    const secret = secretFromTotpUri(enrolled.totpUri);

    const activated = await ops.activate({
      actor,
      headers,
      enrollmentId: enrolled.enrollmentId,
      code: await totpCode(secret, -1),
    });

    expect(activated.ok).toBe(true);
    expect(ops.auditErrors.length).toBe(1);
    expect((await findMfaTotpRow(user.id))?.verifiedAt).not.toBeNull();
  });

  test("AC-156 並行 enroll ×2 → 両応答が勝者の内容へ収束、DB は 1 行", async () => {
    const user = await seedUser("race-enroll");
    const actor = { id: user.id, email: user.email };
    const ops = buildOps();

    const [a, b] = await Promise.all([ops.enroll({ actor }), ops.enroll({ actor })]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a).toEqual(b);
    expect(await countMfaTotpRows(user.id)).toBe(1);
    expect(await countRecoveryCodeRows(user.id)).toBe(10);
  });
});
