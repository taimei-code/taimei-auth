import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { switchCurrentCompany } from "../membership/current-company";
import { addCompany, createSignupCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { acceptInvitation } from "../invitation/accept";
import { removeMember } from "../membership/remove";
import { expectConsumerSeesAnActiveCompanyAndItsRole } from "./consumer-company-view";
import { grepFiles } from "./source-scan";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";
import {
  acceptGrantForTest,
  memberForTest,
  removalGrantForTest,
} from "../membership/__tests__/verified-for-test";

const P = "dcc-test-";
const { run, cleanup } = dbTest(P);

const seedMemberOf = (suffix: string, companies: string[], current: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { lastUsedCompanyId: current });
    for (const [i, co] of companies.entries())
      yield* db.seedMembership(u.id, co, i === 0 ? "MEMBER" : "ADMIN");
    return u;
  });

const seedOwnedCompany = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const owner = yield* db.seedUser(`${suffix}-owner`);
    const co = yield* db.seedCompany(suffix);
    yield* db.seedMembership(owner.id, co, "OWNER");
    return { owner, co };
  });

type Scenario = Parameters<typeof run>[0];

const scenarios: Record<string, Scenario> = {};
const scenario = (writer: string, name: string, body: Scenario) => {
  scenarios[writer] = body;
  test(`${writer}: ${name}`, () => run(body));
};

describe("VerifySession と GetSession の defaultCompanyId は同じ値で、user の ACTIVE な所属のどれかか空で、currentRole はその所属の role", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  scenario(
    "src/company/create.ts",
    "最初の事業所を作り、続けて事業所を追加する",
    Effect.gen(function* () {
      const u = yield* TestDb.use((db) => db.seedUser("creator"));
      yield* createSignupCompany(u.id, { name: `${P}co-signup`, orgCode: "PERSONAL" });
      yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, u.id);
      yield* addCompany(u.id, { name: `${P}co-added`, orgCode: "CORPORATE" });
      yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, u.id);
    }),
  );

  scenario(
    "src/invitation/accept.ts",
    "別の事業所を current に持つ user が招待を受諾する",
    Effect.gen(function* () {
      const db = yield* TestDb;
      const { owner, co } = yield* seedOwnedCompany("inviting");
      const { co: home } = yield* seedOwnedCompany("home");
      const invitee = yield* seedMemberOf("invitee", [home], home);
      const inv = yield* db.seedInvitation({
        companyId: co,
        email: invitee.email,
        role: "ADMIN",
        invitedByUserId: owner.id,
      });
      const invitation = yield* db.readInvitationByToken(inv.token);
      if (!invitation) throw new Error("seed failed");
      yield* acceptInvitation(
        acceptGrantForTest({ actor: { id: invitee.id, email: invitee.email }, invitation }),
      );
      yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, invitee.id);
    }),
  );

  scenario(
    "src/membership/remove.ts",
    "current の事業所から除名される",
    Effect.gen(function* () {
      const { owner, co } = yield* seedOwnedCompany("removing");
      const { co: other } = yield* seedOwnedCompany("remain");
      const member = yield* seedMemberOf("removed", [co, other], co);
      yield* removeMember(
        removalGrantForTest({
          actorUserId: owner.id,
          targetUserId: member.id,
          companyId: co,
          targetRole: "MEMBER",
        }),
      );
      yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, member.id);
    }),
  );

  scenario(
    "src/company/delete.ts",
    "current の事業所が削除される",
    Effect.gen(function* () {
      const { owner, co } = yield* seedOwnedCompany("deleting");
      const { co: other } = yield* seedOwnedCompany("survive");
      const member = yield* seedMemberOf("survivor", [co, other], co);
      yield* deleteCompany(memberForTest(owner.id, co, "OWNER"));
      yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, member.id);
    }),
  );

  scenario(
    "src/membership/current-company.ts",
    "別の所属へ切り替える",
    Effect.gen(function* () {
      const { co: from } = yield* seedOwnedCompany("from");
      const { co: to } = yield* seedOwnedCompany("to");
      const member = yield* seedMemberOf("switcher", [from, to], from);
      yield* switchCurrentCompany({ userId: member.id, companyId: to });
      yield* expectConsumerSeesAnActiveCompanyAndItsRole(P, member.id);
    }),
  );

  test("current 事業所を書き換える呼び手のすべてに、ここの scenario がある", () => {
    const writers = grepFiles(
      "\\b(applyJoin|applyRemoval|applyCompanyRemoval)\\(|\\.updateUserLastUsedCompany\\(",
      "src",
      { tests: "exclude" },
    ).filter((f) => f !== "src/membership/apply-change.ts");
    expect(writers.sort()).toEqual(Object.keys(scenarios).sort());
  });
});
