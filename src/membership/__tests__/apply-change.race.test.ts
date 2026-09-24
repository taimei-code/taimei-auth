import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Layer } from "effect";
import { UserRepo } from "../../account/ports";
import { switchCompany } from "../../account/switch-company";
import { UserRepoLive } from "../../account/wiring";
import { dbTest, expectFailure } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { LastOwner } from "../errors";
import { Forbidden } from "../guard/errors";
import { MembershipRepo } from "../ports";
import { removeMember } from "../remove";
import { MembershipRepoLive } from "../wiring";

const P = "race-test-";
const { run, cleanup } = dbTest(P);

const slowDelete = Layer.effect(
  MembershipRepo,
  Effect.map(MembershipRepo, (live) =>
    MembershipRepo.of({
      ...live,
      deleteMembership: (...args) =>
        Effect.sleep("100 millis").pipe(Effect.andThen(live.deleteMembership(...args))),
    }),
  ),
).pipe(Layer.provide(MembershipRepoLive));

describe("OWNER race", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  // 不安定な失敗を検知するため 5 回繰り返す。
  for (let i = 1; i <= 5; i++) {
    test(`iteration ${i}: 2 OWNER の同時退会は片方だけ成功し、もう片方は last_owner で OWNER が 1 名残る`, () =>
      run(
        Effect.gen(function* () {
          const db = yield* TestDb;
          const co = yield* db.seedCompany(`race-${i}`);
          const owners = [yield* db.seedUser(`owner-${i}-1`), yield* db.seedUser(`owner-${i}-2`)];
          for (const o of owners) yield* db.seedMembership(o.id, co, "OWNER");

          const leave = (userId: string) =>
            Effect.exit(
              removeMember({
                actorUserId: userId,
                targetUserId: userId,
                companyId: co,
                targetRole: "OWNER",
              }),
            );
          const results = yield* Effect.all(
            owners.map((o) => leave(o.id)),
            { concurrency: "unbounded" },
          ).pipe(Effect.provide(slowDelete));

          const failed = results.filter(Exit.isFailure);
          expect(failed.length).toBe(1);
          expectFailure(yield* Effect.flip(failed[0] ?? Exit.void), LastOwner, "last_owner", 409);

          const remaining = yield* db.readMembershipsOfCompany(co);
          expect(remaining.map((r) => r.role)).toEqual(["OWNER"]);
        }),
      ));
  }
});

const holdTxOpenAfterReassign = (
  reassigned: Deferred.Deferred<void>,
  until: Deferred.Deferred<void>,
) =>
  Layer.effect(
    UserRepo,
    Effect.map(UserRepo, (live) =>
      UserRepo.of({
        ...live,
        reassignLastUsedCompanyAfterLeaving: (...args) =>
          live.reassignLastUsedCompanyAfterLeaving(...args).pipe(
            Effect.tap(() => Deferred.succeed(reassigned, undefined)),
            Effect.tap(() => Deferred.await(until).pipe(Effect.timeoutOption("500 millis"))),
          ),
      }),
    ),
  ).pipe(Layer.provide(UserRepoLive));

describe("除名と current 事業所の切替の競合", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("除名の付け替えの後に始めた切替は forbidden になり、除名した事業所は current に残らない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const left = yield* db.seedCompany("sw-left");
        const other = yield* db.seedCompany("sw-other");
        const owner = yield* db.seedUser("sw-owner");
        const member = yield* db.seedUser("sw-member", { lastUsedCompanyId: other });
        yield* db.seedMembership(owner.id, left, "OWNER");
        yield* db.seedMembership(member.id, left, "MEMBER");
        yield* db.seedMembership(member.id, other, "MEMBER");

        const reassigned = yield* Deferred.make<void>();
        const switchFinished = yield* Deferred.make<void>();
        const holdRemovalOpen = holdTxOpenAfterReassign(reassigned, switchFinished);

        const removal = removeMember({
          actorUserId: owner.id,
          targetUserId: member.id,
          companyId: left,
          targetRole: "MEMBER",
        }).pipe(Effect.provide(holdRemovalOpen));
        const switching = Deferred.await(reassigned).pipe(
          Effect.andThen(
            switchCompany({
              actorUserId: member.id,
              fromCompanyId: other,
              targetCompanyId: left,
            }),
          ),
          Effect.exit,
          Effect.tap(() => Deferred.succeed(switchFinished, undefined)),
        );
        const [removed, switched] = yield* Effect.all([removal, switching], {
          concurrency: "unbounded",
        });

        expect(removed).toEqual({ accountDeleted: false });
        expect(Exit.isFailure(switched)).toBe(true);
        expectFailure(yield* Effect.flip(switched), Forbidden, "forbidden", 403);
        expect((yield* db.readUser(member.id))?.lastUsedCompanyId).toBe(other);
      }),
    ));
});

describe("同じ user の別々の事業所からの同時除名", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("先の除名が commit する前に次の除名が付け替えても、current は除名済みの事業所に残らない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const first = yield* db.seedCompany("both-first");
        const second = yield* db.seedCompany("both-second");
        const remaining = yield* db.seedCompany("both-remaining");
        const firstOwner = yield* db.seedUser("both-owner-first");
        const secondOwner = yield* db.seedUser("both-owner-second");
        const member = yield* db.seedUser("both-member", { lastUsedCompanyId: first });
        yield* db.seedMembership(firstOwner.id, first, "OWNER");
        yield* db.seedMembership(secondOwner.id, second, "OWNER");
        for (const co of [first, second, remaining]) {
          yield* db.seedMembership(member.id, co, "MEMBER");
        }

        const secondReassigned = yield* Deferred.make<void>();
        const firstFinished = yield* Deferred.make<void>();
        const removeFrom = (companyId: string, actorUserId: string) =>
          removeMember({ actorUserId, targetUserId: member.id, companyId, targetRole: "MEMBER" });

        const removedFromSecond = removeFrom(second, secondOwner.id).pipe(
          Effect.provide(holdTxOpenAfterReassign(secondReassigned, firstFinished)),
        );
        const removedFromFirst = Deferred.await(secondReassigned).pipe(
          Effect.andThen(removeFrom(first, firstOwner.id)),
          Effect.tap(() => Deferred.succeed(firstFinished, undefined)),
        );
        const results = yield* Effect.all([removedFromSecond, removedFromFirst], {
          concurrency: "unbounded",
        });

        expect(results).toEqual([{ accountDeleted: false }, { accountDeleted: false }]);
        expect((yield* db.readUser(member.id))?.lastUsedCompanyId).toBe(remaining);
      }),
    ));
});
