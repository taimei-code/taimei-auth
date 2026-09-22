import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { NotFound } from "../../membership/guard/errors";
import { dbTest, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { updateCompanyInfo } from "../update";

// company/update use-case (src/company/update.ts) の DB 統合テスト。
// tx 内の before/after の差分と、inactive な company では rollback (404) して audit が発火しないことを検証する。
// 認可 (OWNER のみ) は Guard 層 (requireMembership "OWNER") の責務である。

const P = "coupd-test-";
const { run, cleanup } = dbTest(P);

describe("updateCompanyInfo", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("QA-H-03 正常 更新 → company 行更新 / company_updated audit に before/after diff", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("h03");
        yield* db.seedMembership(owner.id, co, "OWNER");
        const before = yield* db.readCompany(co);
        if (!before) throw new Error("seed failed");

        const result = yield* updateCompanyInfo({
          actorUserId: owner.id,
          companyId: co,
          input: { name: `${P}renamed`, orgCode: "CORPORATE" },
        });
        expect(result.company.name).toBe(`${P}renamed`);
        expect(result.company.orgCode).toBe("CORPORATE");

        const after = yield* db.readCompany(co);
        expect(after?.name).toBe(`${P}renamed`);
        expect(after?.orgCode).toBe("CORPORATE");

        const audits = yield* auditRowsFor(owner.id, "company_updated");
        expect(audits.length).toBe(1);
        expect(audits[0]?.payload).toEqual({
          company_id: co,
          before: { name: before.name, org_code: before.orgCode },
          after: { name: `${P}renamed`, org_code: "CORPORATE" },
        });
      }),
    ));

  test("QA-D-06 inactive company → not_found Result / update rollback / audit 発火なし", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("d06");
        yield* db.seedMembership(owner.id, co, "OWNER");
        yield* db.markCompanyDeleted(co);

        const e = yield* Effect.flip(
          updateCompanyInfo({
            actorUserId: owner.id,
            companyId: co,
            input: { name: `${P}renamed`, orgCode: "CORPORATE" },
          }),
        );
        expectFailure(e, NotFound, "not_found", 404);

        // rollback により audit は発火せず、company の状態 (name / orgCode) も変わらない
        const after = yield* db.readCompany(co);
        expect(after?.name).toBe(`${P}co-d06`);
        expect(after?.activationStatus).toBe("DELETED");
        expect((yield* auditRowsFor(owner.id, "company_updated")).length).toBe(0);
      }),
    ));

  test("QA-E-11 not_found 経路の rollback → mutation なし + audit 非発火", () =>
    run(
      Effect.gen(function* () {
        // updateCompany は存在しない companyId では 0 件更新となり not_found になる。tx 内の audit も rollback で消える。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner");
        const co = yield* db.seedCompany("e11-existing");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const e = yield* Effect.flip(
          updateCompanyInfo({
            actorUserId: owner.id,
            companyId: `${P}nonexistent`,
            input: { name: `${P}renamed`, orgCode: "CORPORATE" },
          }),
        );
        expectFailure(e, NotFound, "not_found", 404);
        expect((yield* auditRowsFor(owner.id, "company_updated")).length).toBe(0);
      }),
    ));

  test("QA-H-12 mutation → audit 発火順 pin (audit.payload.after が UPDATE 完了後の DB state と一致)", () =>
    run(
      Effect.gen(function* () {
        // ADR-0012 の invariant として、mutation を audit の前に同じ tx で emit する。UPDATE 完了後の
        // company 行 (readCompany の返す name / org_code) と audit.after が一致することで、
        // 順序が逆 (audit を先に書き、その後の UPDATE で値が変わる) になる regression を検知する。
        const db = yield* TestDb;
        const owner = yield* db.seedUser("owner-order");
        const co = yield* db.seedCompany("h12", "PERSONAL");
        yield* db.seedMembership(owner.id, co, "OWNER");

        const result = yield* updateCompanyInfo({
          actorUserId: owner.id,
          companyId: co,
          input: { name: `${P}h12-renamed`, orgCode: "CORPORATE" },
        });
        expect(result.company.name).toBe(`${P}h12-renamed`);

        const after = yield* db.readCompany(co);
        const payload = (yield* auditRowsFor(owner.id, "company_updated"))[0]?.payload as Record<
          string,
          unknown
        >;
        expect((payload.after as Record<string, unknown>).name).toBe(after?.name);
        expect((payload.after as Record<string, unknown>).org_code).toBe(after?.orgCode);
      }),
    ));
});
