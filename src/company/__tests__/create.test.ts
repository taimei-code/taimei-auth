import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest, expectFailure, auditRowsFor } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { addCompany, createSignupCompany } from "../create";
import { AlreadyExists } from "../errors";

// use-case が作る company も prefix 名 (db.ids.companyName) にして cleanup の対象に載せる。
const P = "create-test-";
const { run, cleanup } = dbTest(P);
const seedUser = (suffix: string) =>
  TestDb.use((db) => db.seedUser(suffix, { emailVerified: false })).pipe(Effect.map((u) => u.id));

const countCompanyCreatedAudit = (userId: string, companyId: string) =>
  auditRowsFor(userId, "company_created").pipe(
    Effect.map(
      (rows) =>
        rows.filter((r) => (r.payload as { company_id?: string }).company_id === companyId).length,
    ),
  );

const activeMemberships = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const rows = yield* db.readMemberships(userId);
    const active = [];
    for (const m of rows) {
      if ((yield* db.readCompany(m.companyId))?.activationStatus === "ACTIVE") active.push(m);
    }
    return active;
  });

describe("createSignupCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("membership 0 件なら作成し OWNER + last_used + audit を残す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("signup-ok");
        const result = yield* createSignupCompany(userId, {
          name: db.ids.companyName("signup"),
          orgCode: "CORPORATE",
        });

        expect(result.membership.role).toBe("OWNER");
        expect(result.company.activationStatus).toBe("ACTIVE");

        const userRow = yield* db.readUser(userId);
        expect(userRow?.lastUsedCompanyId).toBe(result.company.id);
        expect(yield* countCompanyCreatedAudit(userId, result.company.id)).toBe(1);
      }),
    ));

  test("既に membership があれば already_exists を返し新規作成しない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("signup-dup");
        yield* createSignupCompany(userId, {
          name: db.ids.companyName("first"),
          orgCode: "PERSONAL",
        });

        const e = yield* Effect.flip(
          createSignupCompany(userId, { name: db.ids.companyName("second"), orgCode: "PERSONAL" }),
        );
        expectFailure(e, AlreadyExists, "already_exists", 409);

        const memberships = yield* db.readMemberships(userId);
        expect(memberships.length).toBe(1);
      }),
    ));

  // 0 件ガードが ACTIVE 基準であること (根拠: src/company/create.ts) を固定する。
  // 全 membership 基準に退化すると、全削除した user の再 signup が残存 membership に弾かれ
  // /account ⇄ signup/company の redirect loop に陥る。
  test("所属事業所を全削除した後は ACTIVE 0 件として再作成できる", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("signup-after-delete");
        const first = yield* createSignupCompany(userId, {
          name: db.ids.companyName("first"),
          orgCode: "PERSONAL",
        });

        yield* db.markCompanyDeleted(first.company.id);

        const second = yield* createSignupCompany(userId, {
          name: db.ids.companyName("second"),
          orgCode: "CORPORATE",
        });
        expect(second.membership.role).toBe("OWNER");
        expect(second.company.activationStatus).toBe("ACTIVE");

        const active = yield* activeMemberships(userId);
        expect(active.length).toBe(1);
        expect(active.at(0)?.companyId).toBe(second.company.id);
      }),
    ));
});

describe("addCompany", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("既存 membership があっても作成し OWNER + last_used 更新 + audit を残す", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("add-existing");
        yield* createSignupCompany(userId, {
          name: db.ids.companyName("base"),
          orgCode: "CORPORATE",
        });

        const added = yield* addCompany(userId, {
          name: db.ids.companyName("added"),
          orgCode: "CORPORATE",
        });
        expect(added.membership.role).toBe("OWNER");

        const userRow = yield* db.readUser(userId);
        expect(userRow?.lastUsedCompanyId).toBe(added.company.id); // 新事業所へ切替
        expect(yield* countCompanyCreatedAudit(userId, added.company.id)).toBe(1);

        const memberships = yield* db.readMemberships(userId);
        expect(memberships.length).toBe(2);
      }),
    ));

  test("個人事業主を 2 つ作れる (制限なし)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("add-personal-dup");
        const one = yield* addCompany(userId, {
          name: db.ids.companyName("personal-1"),
          orgCode: "PERSONAL",
        });
        const two = yield* addCompany(userId, {
          name: db.ids.companyName("personal-2"),
          orgCode: "PERSONAL",
        });

        expect(one.company.id).not.toBe(two.company.id);
        expect(one.company.orgCode).toBe("PERSONAL");
        expect(two.company.orgCode).toBe("PERSONAL");

        const memberships = yield* db.readMemberships(userId);
        expect(memberships.length).toBe(2);

        const userRow = yield* db.readUser(userId);
        expect(userRow?.lastUsedCompanyId).toBe(two.company.id); // 最後に作った方が current
      }),
    ));
});
