import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { switchCompany } from "../../account/switch-company";
import { buildApp } from "../../app";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { authLayer, sessionOf } from "../../membership/__tests__/test-layers";
import { Role as ProtoRole } from "../../gen/auth/v1/auth_pb";
import { listCurrentCompanyMembersProgram } from "../auth-handler";

const P = "list-members-";
const { run, cleanup } = dbTest(P);

const listSeenBy = (userId: string) =>
  listCurrentCompanyMembersProgram({ sessionToken: "db" }).pipe(
    Effect.provide(authLayer(() => sessionOf(userId))),
    Effect.map((res) => {
      if (res.outcome.case !== "ok")
        throw new Error(`ListCurrentCompanyMembers: ${res.outcome.case}`);
      return {
        companyId: res.outcome.value.companyId,
        userIds: res.outcome.value.members.map((m) => m.userId).sort(),
      };
    }),
  );

const userIdsOf = (companyId: string) =>
  TestDb.use((db) => db.readMembershipsOfCompany(companyId)).pipe(
    Effect.map((rows) => rows.map((r) => r.userId).sort()),
  );

describe("ListCurrentCompanyMembers は現在の事業所のメンバーだけを返す", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  const seedTwoCompanies = Effect.gen(function* () {
    const db = yield* TestDb;
    const c1 = yield* db.seedCompany("c1");
    const c2 = yield* db.seedCompany("c2");
    const both = yield* db.seedUser("both", { lastUsedCompanyId: c1 });
    const onlyC1 = yield* db.seedUser("only-c1", { lastUsedCompanyId: c1 });
    const onlyC2 = yield* db.seedUser("only-c2", { lastUsedCompanyId: c2 });
    yield* db.seedMembership(both.id, c1, "MEMBER");
    yield* db.seedMembership(both.id, c2, "ADMIN");
    yield* db.seedMembership(onlyC1.id, c1, "OWNER");
    yield* db.seedMembership(onlyC2.id, c2, "OWNER");
    return { c1, c2, both, onlyC1, onlyC2 };
  });

  test("AC-002: 2 つの事業所に所属する人には、現在の事業所 C1 のメンバーだけを返す", () =>
    run(
      Effect.gen(function* () {
        const { c1, both, onlyC2 } = yield* seedTwoCompanies;

        const seen = yield* listSeenBy(both.id);

        expect(seen).toEqual({ companyId: c1, userIds: yield* userIdsOf(c1) });
        expect(seen.userIds).not.toContain(onlyC2.id);
      }),
    ));

  test("AC-001: 実際の join で引いた名前・メールアドレス・role を、user ごとに正しく写す", () =>
    run(
      Effect.gen(function* () {
        const { both, onlyC1 } = yield* seedTwoCompanies;

        const res = yield* listCurrentCompanyMembersProgram({ sessionToken: "db" }).pipe(
          Effect.provide(authLayer(() => sessionOf(both.id))),
        );
        if (res.outcome.case !== "ok") throw new Error(res.outcome.case);
        const members = res.outcome.value.members
          .map(({ userId, name, email, role }) => ({ userId, name, email, role }))
          .sort((a, b) => a.userId.localeCompare(b.userId));

        expect(members).toEqual(
          [
            { userId: both.id, name: "User both", email: both.email, role: ProtoRole.MEMBER },
            { userId: onlyC1.id, name: "User only-c1", email: onlyC1.email, role: ProtoRole.OWNER },
          ].sort((a, b) => a.userId.localeCompare(b.userId)),
        );
      }),
    ));

  test("AC-003: 現在の事業所を C2 に切り替えると、C2 のメンバーを返す", () =>
    run(
      Effect.gen(function* () {
        const { c1, c2, both } = yield* seedTwoCompanies;
        yield* switchCompany({ actorUserId: both.id, fromCompanyId: c1, targetCompanyId: c2 });

        const seen = yield* listSeenBy(both.id);

        expect(seen).toEqual({ companyId: c2, userIds: yield* userIdsOf(c2) });
      }),
    ));
});

describe("ListCurrentCompanyMembers の入口", () => {
  const SERVICE_KEY = "list-members-test-key";
  const app = buildApp({ mountStatic: () => {} });
  const originalEnv = { ...process.env };
  const PATH = "http://localhost/rpc/auth.v1.AuthService/ListCurrentCompanyMembers";
  const post = (headers: Record<string, string>) =>
    app.request(PATH, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ sessionToken: `${P}missing` }),
    });

  beforeEach(() => {
    process.env.AUTH_SERVICE_KEY = SERVICE_KEY;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("AC-013: service key があれば route に届き、存在しない token は SESSION_NOT_FOUND", async () => {
    const res = await post({ "x-service-key": SERVICE_KEY });
    expect([res.status, await res.json()]).toEqual([
      200,
      { error: { reason: "RESULT_SESSION_NOT_FOUND" } },
    ]);
  });

  test("AC-014: service key が無ければ 401", async () => {
    const res = await post({});
    expect([res.status, await res.text()]).toEqual([
      401,
      '{"error":"Unauthorized: invalid service key"}',
    ]);
  });
});
