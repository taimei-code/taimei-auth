import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { auditRowsFor, dbTest, observing } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import {
  actorOf,
  countRecoveryCodeRows,
  enableMfaFor,
  findMfaTotpRow,
} from "../../src/mfa/__tests__/helpers";
import { enroll } from "../../src/mfa/totp";
import { forceDisableMfa, toDisableUserMfaReport } from "../disable-user-mfa";

describe("toDisableUserMfaReport", () => {
  test("changed success is stdout with notified", () => {
    expect(toDisableUserMfaReport("user-1", { ok: true, changed: true, notified: true })).toEqual({
      stream: "stdout",
      exitCode: 0,
      body: { userId: "user-1", changed: true, notified: true },
    });
  });

  test("idempotent success keeps the existing reason key", () => {
    expect(toDisableUserMfaReport("user-1", { ok: true, changed: false })).toEqual({
      stream: "stdout",
      exitCode: 0,
      body: { userId: "user-1", changed: false, reason: "mfa_not_enabled" },
    });
  });

  test("not_found is stderr with the canonical error", () => {
    expect(toDisableUserMfaReport("user-1", { ok: false, error: "not_found" })).toEqual({
      stream: "stderr",
      exitCode: 1,
      body: { userId: "user-1", error: "not_found" },
    });
  });
});

// MFA 運用救済 (CONTEXT.md) の本体。本人のコード検証なしに第二要素を外す唯一の経路なので、tx 2 文 → best-effort 記帳 →
// 完走待ちの通知、という合成を production の AppLayer + TestDb で観測する。
const { run, cleanup } = dbTest("mgmt-mfa-");
const DISABLED_EMAIL_LOG = "[TEST] mfa disabled email for";

describe("forceDisableMfa (統合)", () => {
  afterAll(cleanup);

  test("有効な user: 行と回復コードを消し、mfa_disabled を記帳し、通知を待って notified: true", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("enabled");
        // 有効化通知 (background) を先に drain し、無効化側の log 観測に混ぜない。
        yield* observing(enableMfaFor(user));

        const { value: first, logs } = yield* observing(forceDisableMfa(user.id));
        expect(first).toEqual({ ok: true, changed: true, notified: true });
        expect(yield* findMfaTotpRow(user.id)).toBeUndefined();
        expect(yield* countRecoveryCodeRows(user.id)).toBe(0);
        const rows = yield* auditRowsFor(user.id, "mfa_disabled");
        expect(rows.length).toBe(1);
        expect(rows[0]?.payload).toEqual({ ip: null, userAgent: "management/disable-user-mfa" });
        expect(logs.some((line) => line.includes(`${DISABLED_EMAIL_LOG} ${user.email}`))).toBe(
          true,
        );

        // 再実行は冪等: 変更なし、記帳も通知も増えない。
        const { value: second, logs: secondLogs } = yield* observing(forceDisableMfa(user.id));
        expect(second).toEqual({ ok: true, changed: false });
        expect((yield* auditRowsFor(user.id, "mfa_disabled")).length).toBe(1);
        expect(secondLogs.some((line) => line.includes(DISABLED_EMAIL_LOG))).toBe(false);
      }),
    ));

  test("登録済み未有効 (verifiedAt NULL) の user: 行は消すが changed: false、記帳も通知もしない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const user = yield* db.seedUser("pending");
        yield* enroll({ actor: actorOf(user) });

        const { value, logs } = yield* observing(forceDisableMfa(user.id));
        expect(value).toEqual({ ok: true, changed: false });
        expect(yield* findMfaTotpRow(user.id)).toBeUndefined();
        expect(yield* countRecoveryCodeRows(user.id)).toBe(0);
        expect((yield* auditRowsFor(user.id, "mfa_disabled")).length).toBe(0);
        expect(logs.some((line) => line.includes(DISABLED_EMAIL_LOG))).toBe(false);
      }),
    ));

  test("存在しない user は not_found", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        expect(yield* forceDisableMfa(db.ids.userId("missing"))).toEqual({
          ok: false,
          error: "not_found",
        });
      }),
    ));
});
