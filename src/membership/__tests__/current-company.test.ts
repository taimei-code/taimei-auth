import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { Forbidden } from "../../failures";
import {
  dbTest,
  recordingTransaction,
  expectFailure,
  auditRowsFor,
} from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { switchCurrentCompany } from "../current-company";

const P = "swco-test-";
const { run, cleanup } = dbTest(P);

describe("switchCurrentCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("正常 切替 (別 companyId) → last_used 更新 / company_switched audit", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("h02-a");
        const co2 = yield* db.seedCompany("h02-b");
        const u = yield* db.seedUser("h02", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        yield* db.seedMembership(u.id, co2, "MEMBER");

        const tx = recordingTransaction();
        const result = yield* switchCurrentCompany({ userId: u.id, companyId: co2 }).pipe(
          Effect.provide(tx.layer),
        );
        expect(result).toEqual({ companyId: co2 });
        expect(tx.calls.n).toBe(1);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co2);

        const audits = yield* auditRowsFor(u.id, "company_switched");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({ from_company_id: co1, to_company_id: co2 });
      }),
    ));

  test("現在の事業所と同じ事業所への切り替えは成功し、現在の事業所も audit も変えない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("h09");
        const u = yield* db.seedUser("h09", { lastUsedCompanyId: co });
        yield* db.seedMembership(u.id, co, "OWNER");

        const result = yield* switchCurrentCompany({ userId: u.id, companyId: co });
        expect(result).toEqual({ companyId: co });
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
        const e = yield* Effect.flip(switchCurrentCompany({ userId: u.id, companyId: co2 }));
        expectFailure(e, Forbidden);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co1);
        expect((yield* auditRowsFor(u.id, "company_switched")).length).toBe(0);
      }),
    ));

  test("tx 中除名 race (TOCTOU) → tx 内 findMembership が null → forbidden (tx の外に事前確認が無いので、tx 開始前の除名で同じ経路を通す)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("toctou-a");
        const co2 = yield* db.seedCompany("toctou-b");
        const u = yield* db.seedUser("toctou", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        yield* db.seedMembership(u.id, co2, "MEMBER");

        yield* db.removeMembership(u.id, co2);

        const e = yield* Effect.flip(switchCurrentCompany({ userId: u.id, companyId: co2 }));
        expectFailure(e, Forbidden);
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co1);
        expect((yield* auditRowsFor(u.id, "company_switched")).length).toBe(0);
      }),
    ));

  test("現在の事業所が無い利用者の切り替えは、from_company_id を null にして audit を残す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("d02");
        const u = yield* db.seedUser("d02");
        yield* db.seedMembership(u.id, co, "OWNER");

        const result = yield* switchCurrentCompany({ userId: u.id, companyId: co });
        expect(result).toEqual({ companyId: co });
        const audits = yield* auditRowsFor(u.id, "company_switched");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({ from_company_id: null, to_company_id: co });
        expect((yield* db.readUser(u.id))?.lastUsedCompanyId).toBe(co);
      }),
    ));

  test("呼び手が直前の事業所を渡さなくても、切り替えの audit の from_company_id は DB の現在の事業所になる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const current = yield* db.seedCompany("from-db-current");
        const target = yield* db.seedCompany("from-db-target");
        const u = yield* db.seedUser("from-db", { lastUsedCompanyId: current });
        yield* db.seedMembership(u.id, current, "OWNER");
        yield* db.seedMembership(u.id, target, "MEMBER");

        yield* switchCurrentCompany({ userId: u.id, companyId: target });

        const audits = yield* auditRowsFor(u.id, "company_switched");
        expect(audits.map((audit) => audit.payload)).toEqual([
          { from_company_id: current, to_company_id: target },
        ]);
      }),
    ));

  test("mutation → audit 発火順 pin (audit の to_company_id が UPDATE 後の user.last_used_company_id と一致)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co1 = yield* db.seedCompany("order-a");
        const co2 = yield* db.seedCompany("order-b");
        const u = yield* db.seedUser("order", { lastUsedCompanyId: co1 });
        yield* db.seedMembership(u.id, co1, "OWNER");
        yield* db.seedMembership(u.id, co2, "MEMBER");

        const result = yield* switchCurrentCompany({ userId: u.id, companyId: co2 });
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
