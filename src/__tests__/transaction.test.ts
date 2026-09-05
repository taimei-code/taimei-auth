import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Data, Effect } from "effect";
import {
  findMembership,
  insertMembership,
  generateMembershipId,
} from "@/db/repositories/membership";
import { createSeedHelpers } from "../handlers/__tests__/helpers";
import { Transaction, TransactionLive } from "../transaction";

// design §3.7 / ADR-0017: tx 内の failure は常に rollback。callback の Effect が Fail / Die した時に drizzle の tx が
// commit されない (旧 RejectAccept / OwnerInvariantViolation の sentinel throw と同じ意味論) ことを DB で観測する。
class Rejected extends Data.TaggedError("Rejected")<{ readonly why: string }> {}

const P = "tx-test-";
const { cleanup, seedUser, seedCompany } = createSeedHelpers(P);
const run = <A, E>(p: Effect.Effect<A, E, Transaction>) =>
  Effect.runPromise(Effect.provide(p, TransactionLive));

describe("Transaction.run", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("成功した callback は commit され、戻り値がそのまま返る", async () => {
    const u = await seedUser("ok");
    const co = await seedCompany("ok");
    const result = await run(
      Transaction.use((tx) =>
        tx.run((t) =>
          Effect.promise(() =>
            insertMembership(
              { id: generateMembershipId(), userId: u.id, companyId: co, role: "MEMBER" },
              t,
            ),
          ),
        ),
      ),
    );
    expect(result.role).toBe("MEMBER");
    expect((await findMembership(u.id, co))?.role).toBe("MEMBER");
  });

  test("callback が typed failure を返すと rollback され、failure がそのまま E に載る", async () => {
    const u = await seedUser("fail");
    const co = await seedCompany("fail");
    const e = await run(
      Effect.flip(
        Transaction.use((tx) =>
          tx.run((t) =>
            Effect.gen(function* () {
              yield* Effect.promise(() =>
                insertMembership(
                  { id: generateMembershipId(), userId: u.id, companyId: co, role: "MEMBER" },
                  t,
                ),
              );
              return yield* new Rejected({ why: "invariant" });
            }),
          ),
        ),
      ),
    );
    expect(e).toBeInstanceOf(Rejected);
    expect(await findMembership(u.id, co)).toBeUndefined();
  });

  test("callback の defect も rollback され、runPromise は同一 object で reject する", async () => {
    const u = await seedUser("die");
    const co = await seedCompany("die");
    const boom = new Error("boom");
    await expect(
      run(
        Transaction.use((tx) =>
          tx.run((t) =>
            Effect.gen(function* () {
              yield* Effect.promise(() =>
                insertMembership(
                  { id: generateMembershipId(), userId: u.id, companyId: co, role: "MEMBER" },
                  t,
                ),
              );
              return yield* Effect.die(boom);
            }),
          ),
        ),
      ),
    ).rejects.toBe(boom);
    expect(await findMembership(u.id, co)).toBeUndefined();
  });

  test("callback の外側の環境 (R) が tx 内の program に引き継がれる", async () => {
    class Greeting extends Data.TaggedError("Greeting")<{ readonly text: string }> {}
    const e = await run(
      Effect.flip(
        Transaction.use((tx) =>
          tx.run(() =>
            Effect.gen(function* () {
              // Transaction service 自身を tx 内から yield* できる = 外側の Context が渡っている
              yield* Transaction;
              return yield* new Greeting({ text: "hi" });
            }),
          ),
        ),
      ),
    );
    expect(e).toBeInstanceOf(Greeting);
  });
});
