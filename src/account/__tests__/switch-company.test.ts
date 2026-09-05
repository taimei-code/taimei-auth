import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Forbidden } from "../../membership/guard/errors";
import {
  dbTest,
  recordingTransaction,
  expectFailure,
  auditRowsFor,
} from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { switchCompany } from "../switch-company";

// switch-company use-case (src/account/switch-company.ts) の DB 統合テスト。
// same-company 短絡 (tx 未 open) / 非メンバー 403 / tx 内 findMembership TOCTOU 再検証を検証。
// 認可 (session 通過) は Guard 層 (requireActor) の責務。

const P = "swco-test-";
const { run, cleanup } = dbTest(P);

describe("switchCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-02 正常 切替 (別 companyId) → last_used 更新 / company_switched audit", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("h02-a");
        const co2 = yield* db.seedCompany("h02-b");
        const u = yield* db.seedUser("h02", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        yield* db.seedMembership(u.id, co2, "MEMBER");

        const tx = recordingTransaction();
        const result = yield* switchCompany({
          actorUserId: u.id,
          fromCompanyId: co1,
          targetCompanyId: co2,
        }).pipe(Effect.provide(tx.layer));
        expect(result).toEqual({ companyId: co2 });
        expect(tx.calls.n).toBe(1);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co2);

        const audits = yield* auditRowsFor(u.id, "company_switched");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({ from_company_id: co1, to_company_id: co2 });
      }),
    ));

  test("QA-H-09 same-company 短絡 (fromCompanyId === targetCompanyId) → 200 / tx open せず audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("h09");
        const u = yield* db.seedUser("h09", { lastUsedCompanyId: co });
        yield* db.seedMembership(u.id, co, "OWNER");

        const tx = recordingTransaction();
        const result = yield* switchCompany({
          actorUserId: u.id,
          fromCompanyId: co,
          targetCompanyId: co,
        }).pipe(Effect.provide(tx.layer));
        expect(result).toEqual({ companyId: co });
        expect(tx.calls.n).toBe(0);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co);
        expect((yield* auditRowsFor(u.id, "company_switched")).length).toBe(0);
      }),
    ));

  test("非メンバー user が切替 → forbidden / last_used 未変更 / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("nm-a");
        const co2 = yield* db.seedCompany("nm-b");
        const u = yield* db.seedUser("nm", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        // co2 には所属していない。

        const e = yield* Effect.flip(
          switchCompany({ actorUserId: u.id, fromCompanyId: co1, targetCompanyId: co2 }),
        );
        expectFailure(e, Forbidden, "forbidden", 403);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co1);
        expect((yield* auditRowsFor(u.id, "company_switched")).length).toBe(0);
      }),
    ));

  test("QA-E-05 tx 中除名 race (TOCTOU) → tx 内 findMembership が null → forbidden", () =>
    run(
      Effect.gen(function* () {
        // tx 内で findMembership を再取得し、tx 外 pre-check と更新の間で除名 (別 tx の
        // deleteMembership) が入った場合 forbidden を返す。tx 外 pre-check のみに退化すると
        // 無効な company_id が last_used に silent 書き込みされる。
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("toctou-a");
        const co2 = yield* db.seedCompany("toctou-b");
        const u = yield* db.seedUser("toctou", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        yield* db.seedMembership(u.id, co2, "MEMBER");

        // 事前に co2 の membership を削除して「tx 内 findMembership が null」状態を作る。
        // (真の race を再現するにはランタイム介入が要るが、tx 外 check なしの現行 use-case では
        // 「tx 開始時点で既に不在」で同じ経路に落ちるため、この simulation で契約検証が成立する)。
        yield* db.removeMembership(u.id, co2);

        const e = yield* Effect.flip(
          switchCompany({ actorUserId: u.id, fromCompanyId: co1, targetCompanyId: co2 }),
        );
        expectFailure(e, Forbidden, "forbidden", 403);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co1);
        expect((yield* auditRowsFor(u.id, "company_switched")).length).toBe(0);
      }),
    ));

  test("QA-D-02 初回切替 (lastUsedCompanyId=null) → from_company_id=null で audit / 切替成立", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("d02");
        const u = yield* db.seedUser("d02");
        yield* db.seedMembership(u.id, co, "OWNER");

        const result = yield* switchCompany({
          actorUserId: u.id,
          fromCompanyId: null,
          targetCompanyId: co,
        });
        expect(result).toEqual({ companyId: co });
        const audits = yield* auditRowsFor(u.id, "company_switched");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({ from_company_id: null, to_company_id: co });
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co);
      }),
    ));

  test("QA-H-12 mutation → audit 発火順 pin (audit の to_company_id が UPDATE 後の user.last_used_company_id と一致)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("order-a");
        const co2 = yield* db.seedCompany("order-b");
        const u = yield* db.seedUser("order", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        yield* db.seedMembership(u.id, co2, "MEMBER");

        const result = yield* switchCompany({
          actorUserId: u.id,
          fromCompanyId: co1,
          targetCompanyId: co2,
        });
        expect(result.companyId).toBe(co2);
        const finalLastUsed = (yield* db.readUser(u.id))?.lastUsedCompanyId;
        const payload = (yield* auditRowsFor(u.id, "company_switched"))[0]?.payload as Record<
          string,
          unknown
        >;
        expect(payload.to_company_id).toBe(finalLastUsed);
      }),
    ));
});
