import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db/client";
import { findUserById } from "@/db/repositories/user";
import { twoFactor } from "@/db/schema";
import { createSeedHelpers } from "../../handlers/__tests__/helpers";
import type { Actor } from "../../membership/guard/core";
import { activate } from "../registration/activate";
import { disable } from "../registration/disable";
import { enroll } from "../registration/enroll";
import {
  ensureCanActivate,
  ensureCanEnroll,
  ensureDisableCanProceed,
  readEnrollmentFacts,
} from "../registration/state";
import type { MfaFailure } from "../error-mapping";
import { readStatus } from "../registration/status";
import {
  ATTEMPT_BUDGET_ABSENT,
  attemptBudgetTtlSeconds,
  countTwoFactorRows,
  findTwoFactorRow,
  MFA_ENROLLMENT_STATE_NAMES,
  seedMfaEnrollmentState,
  totpCode,
  wrongTotpCode,
  type MfaEnrollmentStateName,
} from "./helpers";

// 「MFA 登録状態」× 操作 entry の評決マトリクスの統合テスト。期待値 (下の MATRIX) は
// docs/adr/0013-mfa-totp-challenge.md の 5 状態マトリクスからの転記で、実装からは導出しない。

const P = "mfa-state-";
const { cleanup, seedUser } = createSeedHelpers(P);

type Verdict = { error: string; status: number } | undefined;

const verdictOf = (rejected: { error: string; status: number } | undefined): Verdict =>
  rejected ? { error: rejected.error, status: rejected.status } : undefined;

const ALREADY: Verdict = { error: "already_enabled", status: 409 };
const NOT_ENABLED: Verdict = { error: "not_enabled", status: 409 };
const CHALLENGE_EXPIRED: Verdict = { error: "challenge_expired", status: 401 };

const MATRIX: {
  state: MfaEnrollmentStateName;
  enroll: Verdict;
  activate: Verdict;
  disable: Verdict;
  interrupted: { enrollmentRecord: "absent" | "unverified" } | undefined;
  /** ADR-0013 §7 の「状態取得 (表示)」列。readStatus.enabled で観測する。 */
  display: boolean;
}[] = [
  {
    state: "unregistered",
    enroll: undefined,
    activate: { error: "not_found", status: 404 },
    disable: NOT_ENABLED,
    interrupted: undefined,
    display: false,
  },
  {
    state: "enrolledNotActivated",
    enroll: undefined,
    activate: undefined,
    disable: NOT_ENABLED,
    interrupted: undefined,
    display: false,
  },
  {
    state: "active",
    enroll: ALREADY,
    activate: ALREADY,
    disable: undefined,
    interrupted: undefined,
    display: true,
  },
  {
    state: "interruptedDisable",
    enroll: ALREADY,
    activate: ALREADY,
    disable: undefined,
    interrupted: undefined,
    display: false,
  },
  {
    state: "interruptedActivationUnverified",
    enroll: ALREADY,
    activate: ALREADY,
    disable: undefined,
    interrupted: { enrollmentRecord: "unverified" },
    display: true,
  },
  {
    state: "interruptedActivationNoRow",
    enroll: ALREADY,
    activate: ALREADY,
    // 行なしは検証すべき secret が無く、前提条件で 401 に落として試行枠を空費させない (ADR-0013 §7)
    disable: CHALLENGE_EXPIRED,
    interrupted: { enrollmentRecord: "absent" },
    display: true,
  },
];

const evaluateEntries = async (actor: Actor) => ({
  enroll: verdictOf(await ensureCanEnroll(actor)),
  activate: verdictOf(await ensureCanActivate(actor)),
  disable: verdictOf(await ensureDisableCanProceed(actor)),
  interrupted: (await readEnrollmentFacts(actor)).interrupted,
});

describe("MFA 登録状態の操作単位 entry", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-02 QA-D-01 5 状態 (6 fixture) × 4 entry + 表示の評決がマトリクスと一致する", async () => {
    // 状態を増やしたのに MATRIX へ行を足し忘れると、以降の全 table test が旧 6 行のまま
    // 緑で通る。網羅の照合を先に固定する。
    expect(MATRIX.map((row) => row.state).sort()).toEqual([...MFA_ENROLLMENT_STATE_NAMES].sort());

    const observed: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const row of MATRIX) {
      const user = await seedUser(`h02-${row.state.toLowerCase()}`);
      const fx = await seedMfaEnrollmentState(user, row.state);
      observed[row.state] = {
        ...(await evaluateEntries(fx.actor)),
        display: (await readStatus(fx.actor)).enabled,
      };
      expected[row.state] = {
        enroll: row.enroll,
        activate: row.activate,
        disable: row.disable,
        interrupted: row.interrupted,
        display: row.display,
      };
    }

    expect(observed).toEqual(expected);
  });

  test("QA-M-01 受理セルの post-state — enroll→登録済み未有効 / activate→有効 / disable→未登録", async () => {
    const enrollUser = await seedUser("m01-enroll");
    const enrollFx = await seedMfaEnrollmentState(enrollUser, "unregistered");
    expect((await enroll(enrollFx.actor, enrollFx.session.headers)).ok).toBe(true);
    expect((await findUserById(enrollUser.id))?.twoFactorEnabled).toBe(false);
    expect((await findTwoFactorRow(enrollUser.id))?.verified).toBe(false);

    const activateUser = await seedUser("m01-activate");
    const activateFx = await seedMfaEnrollmentState(activateUser, "enrolledNotActivated");
    const activated = await activate({
      actor: activateFx.actor,
      headers: activateFx.session.headers,
      code: await totpCode(activateFx.secret ?? ""),
    });
    expect(activated.ok).toBe(true);
    expect((await findUserById(activateUser.id))?.twoFactorEnabled).toBe(true);
    expect((await findTwoFactorRow(activateUser.id))?.verified).toBe(true);

    const disableUser = await seedUser("m01-disable");
    const disableFx = await seedMfaEnrollmentState(disableUser, "active");
    const disabled = await disable({
      actor: disableFx.actor,
      headers: disableFx.session.headers,
      code: await totpCode(disableFx.secret ?? ""),
      kind: "totp",
    });
    expect(disabled.ok).toBe(true);
    expect((await findUserById(disableUser.id))?.twoFactorEnabled).toBe(false);
    expect(await countTwoFactorRows(disableUser.id)).toBe(0);
  });

  test("QA-M-02 disable の受理は code kind に依存しない (totp / recovery_code)", async () => {
    const totpUser = await seedUser("m02-totp");
    const viaTotp = await seedMfaEnrollmentState(totpUser, "active");
    const byTotp = await disable({
      actor: viaTotp.actor,
      headers: viaTotp.session.headers,
      code: await totpCode(viaTotp.secret ?? ""),
      kind: "totp",
    });
    expect(byTotp.ok).toBe(true);
    expect(await countTwoFactorRows(totpUser.id)).toBe(0);

    const recoveryUser = await seedUser("m02-recovery");
    const viaRecovery = await seedMfaEnrollmentState(recoveryUser, "active");
    const byRecovery = await disable({
      actor: viaRecovery.actor,
      headers: viaRecovery.session.headers,
      code: viaRecovery.recoveryCodes?.[0] ?? "",
      kind: "recovery_code",
    });
    expect(byRecovery.ok).toBe(true);
    expect(await countTwoFactorRows(recoveryUser.id)).toBe(0);
  });

  test("QA-M-07 「中断した有効化」の disable は 3 通りに分かれ、行なしだけ枠を消費しない", async () => {
    // (a) 未 verified 行 + 正しいコード → 成功。この状態からの唯一の自己復旧口 (詳細: ADR-0013)
    const aUser = await seedUser("m07-a");
    const a = await seedMfaEnrollmentState(aUser, "interruptedActivationUnverified");
    const recovered = await disable({
      actor: a.actor,
      headers: a.session.headers,
      code: await totpCode(a.secret ?? ""),
      kind: "totp",
    });
    expect(recovered.ok).toBe(true);
    expect(await countTwoFactorRows(aUser.id)).toBe(0);
    expect((await findUserById(aUser.id))?.twoFactorEnabled).toBe(false);
    expect(await attemptBudgetTtlSeconds(aUser.id)).toBe(ATTEMPT_BUDGET_ABSENT);

    // (b) 未 verified 行 + 誤コード → 400。枠は verify より先に 1 消費される
    const bUser = await seedUser("m07-b");
    const b = await seedMfaEnrollmentState(bUser, "interruptedActivationUnverified");
    const rejected = await disable({
      actor: b.actor,
      headers: b.session.headers,
      code: await wrongTotpCode(b.secret ?? ""),
      kind: "totp",
    });
    expect(rejected).toEqual({ ok: false, error: "invalid_code", status: 400 });
    expect(await attemptBudgetTtlSeconds(bUser.id)).toBeGreaterThan(0);

    // (c) 行なし → 前提条件で 401。永久に成功しない検証で枠を空費させない (正しいコードでも
    // 5 回で 429 に達する事故を防ぐ)。何度呼んでも枠は消費されない。
    const cUser = await seedUser("m07-c");
    const c = await seedMfaEnrollmentState(cUser, "interruptedActivationNoRow");
    for (let attempt = 0; attempt < 6; attempt++) {
      const expired = await disable({
        actor: c.actor,
        headers: c.session.headers,
        code: await totpCode(c.secret ?? ""),
        kind: "totp",
      });
      expect(expired).toEqual({ ok: false, error: "challenge_expired", status: 401 });
    }
    expect(await attemptBudgetTtlSeconds(cUser.id)).toBe(ATTEMPT_BUDGET_ABSENT);
  });

  test("QA-D-02 「中断した無効化」の非対称 — enroll 拒否 / disable 受理 / 表示は無効だが inEffect", async () => {
    const user = await seedUser("d02");
    const fx = await seedMfaEnrollmentState(user, "interruptedDisable");

    expect(verdictOf(await ensureCanEnroll(fx.actor))).toEqual(ALREADY);
    expect(await ensureDisableCanProceed(fx.actor)).toBeUndefined();
    // enabled=false (無効バッジ) だが inEffect=true — SPA はこれで disable を出し袋小路を防ぐ
    const status = await readStatus(fx.actor);
    expect(status.enabled).toBe(false);
    expect(status.inEffect).toBe(true);
  });

  test("QA-M-09 MFA_CHALLENGE_ENABLED=false でも全セルの評決が同一 (kill-switch と直交)", async () => {
    const fixtures: { state: MfaEnrollmentStateName; actor: Actor }[] = [];
    for (const row of MATRIX) {
      const user = await seedUser(`m09-${row.state.toLowerCase()}`);
      const fx = await seedMfaEnrollmentState(user, row.state);
      fixtures.push({ state: row.state, actor: fx.actor });
    }
    const evaluateAll = async (): Promise<Record<string, unknown>> => {
      const results: Record<string, unknown> = {};
      for (const { state, actor } of fixtures) results[state] = await evaluateEntries(actor);
      return results;
    };

    const withChallengeOn = await evaluateAll();
    const original = process.env.MFA_CHALLENGE_ENABLED;
    process.env.MFA_CHALLENGE_ENABLED = "false";
    try {
      expect(await evaluateAll()).toEqual(withChallengeOn);
    } finally {
      if (original === undefined) delete process.env.MFA_CHALLENGE_ENABLED;
      else process.env.MFA_CHALLENGE_ENABLED = original;
    }
    // kill-switch はログイン境界だけに効く、という直交性の固定 (事故シナリオ: ADR-0013 §7)
  });

  test("QA-I-01 enroll を繰り返しても two_factor 行は増えない", async () => {
    const user = await seedUser("i01");
    const fx = await seedMfaEnrollmentState(user, "unregistered");

    expect((await enroll(fx.actor, fx.session.headers)).ok).toBe(true);
    const afterFirst = await countTwoFactorRows(user.id);
    expect((await enroll(fx.actor, fx.session.headers)).ok).toBe(true);
    expect((await enroll(fx.actor, fx.session.headers)).ok).toBe(true);

    expect(await countTwoFactorRows(user.id)).toBe(afterFirst);
  });

  test("QA-I-03 user あたり 2 行目は DB UNIQUE で fail-closed に拒否される", async () => {
    const user = await seedUser("i03");
    await seedMfaEnrollmentState(user, "active");
    expect(await countTwoFactorRows(user.id)).toBe(1);

    // 並行 enroll の deleteMany+create 競合で 2 行になる窓を、直接 INSERT で再現して制約を突く。
    let violated = false;
    await db
      .insert(twoFactor)
      .values({
        id: `${user.id}-dup`,
        secret: "x",
        backupCodes: "[]",
        userId: user.id,
        verified: false,
      })
      .catch(() => {
        violated = true;
      });
    expect(violated).toBe(true);
    expect(await countTwoFactorRows(user.id)).toBe(1);
  });

  test("QA-I-02 同一状態で 2 回連続の評決が一致する (読み取りは状態を変えない)", async () => {
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = {};
    for (const row of MATRIX) {
      const user = await seedUser(`i02-${row.state.toLowerCase()}`);
      const fx = await seedMfaEnrollmentState(user, row.state);
      const rowBefore = await findTwoFactorRow(user.id);
      first[row.state] = await evaluateEntries(fx.actor);
      second[row.state] = await evaluateEntries(fx.actor);
      expect(await findTwoFactorRow(user.id)).toEqual(rowBefore);
    }

    expect(second).toEqual(first);
  });

  // 前提条件由来の error だけを評決へ写す。challenge_expired は「中断した有効化 × 行なし」を disable
  // が前提条件で弾く評決 (試行枠を空費させない)。invalid_code / locked はコード検証以降の失敗で
  // 前提条件としては「受理」に畳む。
  const PRECONDITION_ERRORS = new Set([
    "already_enabled",
    "not_enabled",
    "not_found",
    "challenge_expired",
  ]);
  const preconditionVerdict = (result: { ok: true } | MfaFailure): Verdict =>
    !result.ok && PRECONDITION_ERRORS.has(result.error)
      ? { error: result.error, status: result.status }
      : undefined;

  test("QA-M-12 entry の評決と use-case の前提条件判定が全セルで一致する (保存)", async () => {
    const viaEntry: Record<string, unknown> = {};
    const viaUseCase: Record<string, unknown> = {};
    for (const row of MATRIX) {
      const entryUser = await seedUser(`m12x-${row.state.toLowerCase()}`);
      const entryFx = await seedMfaEnrollmentState(entryUser, row.state);
      const entries = await evaluateEntries(entryFx.actor);
      viaEntry[row.state] = {
        enroll: entries.enroll,
        activate: entries.activate,
        disable: entries.disable,
      };

      // use-case は副作用を持つため 1 操作 1 user で使い捨てる
      const observe = async (op: "enroll" | "activate" | "disable"): Promise<Verdict> => {
        const user = await seedUser(`m12-${op}-${row.state.toLowerCase()}`);
        const fx = await seedMfaEnrollmentState(user, row.state);
        const code = fx.secret ? await totpCode(fx.secret) : "123456";
        const result =
          op === "enroll"
            ? await enroll(fx.actor, fx.session.headers)
            : op === "activate"
              ? await activate({ actor: fx.actor, headers: fx.session.headers, code })
              : await disable({ actor: fx.actor, headers: fx.session.headers, code, kind: "totp" });
        return preconditionVerdict(result);
      };
      viaUseCase[row.state] = {
        enroll: await observe("enroll"),
        activate: await observe("activate"),
        disable: await observe("disable"),
      };
    }

    expect(viaEntry).toEqual(viaUseCase);
  });
});
