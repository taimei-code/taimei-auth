import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { dbTest, expectFailure } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { LastOwner } from "../errors";
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
