import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { checkMembershipsProgram } from "../company-handler";

const P = "check-memberships-";
const { run, cleanup } = dbTest(P);

const check = (companyId: string, userIds: readonly string[]) =>
  checkMembershipsProgram({ companyId, userIds }).pipe(
    Effect.map(({ companyActive, memberUserIds }) => ({
      companyActive,
      memberUserIds: memberUserIds.toSorted(),
    })),
  );

describe("CheckMemberships は、渡した人のうち事業所に所属する人だけを返す", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("ACTIVE な事業所では、所属する人だけを返し、所属しない人を返さない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("active");
        const a = yield* db.seedUser("a");
        const b = yield* db.seedUser("b");
        const outsider = yield* db.seedUser("outsider");
        yield* db.seedMembership(a.id, co, "OWNER");
        yield* db.seedMembership(b.id, co, "MEMBER");

        const seen = yield* check(co, [a.id, b.id, outsider.id]);

        expect(seen).toEqual({
          companyActive: true,
          memberUserIds: [a.id, b.id].toSorted(),
        });
      }),
    ));

  test("削除済みの事業所は ACTIVE でなく、誰も返さない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("deleted");
        const a = yield* db.seedUser("deleted-a");
        yield* db.seedMembership(a.id, co, "OWNER");
        yield* db.markCompanyDeleted(co);

        expect(yield* check(co, [a.id])).toEqual({ companyActive: false, memberUserIds: [] });
      }),
    ));

  test("存在しない事業所は ACTIVE でなく、誰も返さない", () =>
    run(
      Effect.gen(function* () {
        expect(yield* check(`${P}missing`, [`${P}someone`])).toEqual({
          companyActive: false,
          memberUserIds: [],
        });
      }),
    ));

  test("別の事業所だけに所属する人は返さない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const co = yield* db.seedCompany("own");
        const other = yield* db.seedCompany("other");
        const member = yield* db.seedUser("own-member");
        const elsewhere = yield* db.seedUser("elsewhere");
        yield* db.seedMembership(member.id, co, "OWNER");
        yield* db.seedMembership(elsewhere.id, other, "OWNER");

        expect(yield* check(co, [member.id, elsewhere.id])).toEqual({
          companyActive: true,
          memberUserIds: [member.id],
        });
      }),
    ));

  test("user_ids が空でも、ACTIVE な事業所なら ACTIVE と答える", () =>
    run(
      Effect.gen(function* () {
        const co = yield* TestDb.use((db) => db.seedCompany("empty"));

        expect(yield* check(co, [])).toEqual({ companyActive: true, memberUserIds: [] });
      }),
    ));
});
