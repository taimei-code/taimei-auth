import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Session } from "../auth";
import { backfillOrphanCleanup } from "../account/backfill-orphan-cleanup";
import { switchCompany } from "../account/switch-company";
import { addCompany, createSignupCompany } from "../company/create";
import { deleteCompany } from "../company/delete";
import { acceptInvitation } from "../invitation/accept";
import { authLayer } from "../membership/__tests__/test-layers";
import { MembershipRepo } from "../membership/ports";
import { removeMember } from "../membership/remove";
import { grepFiles } from "./grep-files";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";
import { verifySessionProgram } from "../rpc/auth-handler";

const P = "dcc-test-";
const { run, cleanup } = dbTest(P);

const defaultCompanyIdSeenByConsumer = (userId: string) =>
  verifySessionProgram({ sessionToken: "contract" }).pipe(
    Effect.provide(
      authLayer(
        () =>
          ({
            user: { id: userId },
            session: { id: `${P}s-${userId}`, expiresAt: new Date("2030-01-01") },
          }) as unknown as Session,
      ),
    ),
    Effect.map((res) => {
      if (res.outcome.case !== "ok") throw new Error(`VerifySession: ${res.outcome.case}`);
      return res.outcome.value.user?.defaultCompanyId;
    }),
  );

const expectDefaultCompanyIsActiveMembership = (userId: string) =>
  Effect.gen(function* () {
    const seen = yield* defaultCompanyIdSeenByConsumer(userId);
    const active = (yield* MembershipRepo.use((repo) => repo.findMembershipsByUserId(userId)))
      .filter((m) => m.companyActivationStatus === "ACTIVE")
      .map((m) => m.companyId);
    if (active.length === 0) expect(seen).toBeUndefined();
    else expect(active).toContain(String(seen));
  });

const seedMemberOf = (suffix: string, companies: string[], current: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { lastUsedCompanyId: current });
    for (const co of companies) yield* db.seedMembership(u.id, co, "MEMBER");
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

describe("VerifySession の defaultCompanyId は、user の ACTIVE な所属のどれかか空", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  scenario(
    "src/company/create.ts",
    "最初の事業所を作り、続けて事業所を追加する",
    Effect.gen(function* () {
      const u = yield* TestDb.use((db) => db.seedUser("creator"));
      yield* createSignupCompany(u.id, { name: `${P}co-signup`, orgCode: "PERSONAL" });
      yield* expectDefaultCompanyIsActiveMembership(u.id);
      yield* addCompany(u.id, { name: `${P}co-added`, orgCode: "CORPORATE" });
      yield* expectDefaultCompanyIsActiveMembership(u.id);
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
        role: "MEMBER",
        invitedByUserId: owner.id,
      });
      const invitation = yield* db.readInvitationByToken(inv.token);
      if (!invitation) throw new Error("seed failed");
      yield* acceptInvitation({ actor: { id: invitee.id, email: invitee.email }, invitation });
      yield* expectDefaultCompanyIsActiveMembership(invitee.id);
    }),
  );

  scenario(
    "src/membership/remove.ts",
    "current の事業所から除名される",
    Effect.gen(function* () {
      const { owner, co } = yield* seedOwnedCompany("removing");
      const { co: other } = yield* seedOwnedCompany("remain");
      const member = yield* seedMemberOf("removed", [co, other], co);
      yield* removeMember({
        actorUserId: owner.id,
        targetUserId: member.id,
        companyId: co,
        targetRole: "MEMBER",
      });
      yield* expectDefaultCompanyIsActiveMembership(member.id);
    }),
  );

  scenario(
    "src/company/delete.ts",
    "current の事業所が削除される",
    Effect.gen(function* () {
      const { owner, co } = yield* seedOwnedCompany("deleting");
      const { co: other } = yield* seedOwnedCompany("survive");
      const member = yield* seedMemberOf("survivor", [co, other], co);
      yield* deleteCompany(owner.id, co);
      yield* expectDefaultCompanyIsActiveMembership(member.id);
    }),
  );

  scenario(
    "src/account/backfill-orphan-cleanup.ts",
    "DELETED の事業所に membership が残る user を backfill で掃除する",
    Effect.gen(function* () {
      const db = yield* TestDb;
      const { co: ghost } = yield* seedOwnedCompany("ghost");
      const { co: active } = yield* seedOwnedCompany("active");
      const member = yield* seedMemberOf("ghosted", [ghost, active], ghost);
      yield* db.markCompanyDeleted(ghost, { deletedAt: true });
      yield* backfillOrphanCleanup({ execute: true });
      yield* expectDefaultCompanyIsActiveMembership(member.id);
    }),
  );

  scenario(
    "src/account/switch-company.ts",
    "別の所属へ切り替える",
    Effect.gen(function* () {
      const { co: from } = yield* seedOwnedCompany("from");
      const { co: to } = yield* seedOwnedCompany("to");
      const member = yield* seedMemberOf("switcher", [from, to], from);
      yield* switchCompany({ actorUserId: member.id, fromCompanyId: from, targetCompanyId: to });
      yield* expectDefaultCompanyIsActiveMembership(member.id);
    }),
  );

  test("current 事業所を書き換える呼び手のすべてに、ここの scenario がある", () => {
    const writers = grepFiles(
      "\\b(applyJoin|applyRemoval|applyCompanyRemoval)\\(|\\.updateUserLastUsedCompany\\(",
      "src",
      { excludeTests: true },
    ).filter((f) => f !== "src/membership/apply-change.ts");
    expect(writers.sort()).toEqual(Object.keys(scenarios).sort());
  });
});
