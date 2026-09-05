import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Data, Effect, Exit } from "effect";
import type { DbTx } from "@/db/transaction";
import { MembershipRepo } from "../membership/ports";
import { Transaction } from "../transaction";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

// design §3.7 / ADR-0017: tx 内の failure は常に rollback。callback の Effect が Fail / Die した時に drizzle の tx が
// commit されない (旧 RejectAccept / OwnerInvariantViolation の sentinel throw と同じ意味論) ことを DB で観測する。
// 被験体の書き込みは production と同じ Effect face (MembershipRepo) で行う。
class Rejected extends Data.TaggedError("Rejected")<{ readonly why: string }> {}

const P = "tx-test-";
const { run, cleanup } = dbTest(P);

const insertIn = (t: DbTx, u: string, co: string, suffix: string) =>
  MembershipRepo.use((repo) =>
    repo.insertMembership({ id: `${P}m-${suffix}`, userId: u, companyId: co, role: "MEMBER" }, t),
  );

describe("Transaction.run", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("成功した callback は commit され、戻り値がそのまま返る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const u = yield* db.seedUser("ok");
        const co = yield* db.seedCompany("ok");
        const result = yield* Transaction.use((tx) => tx.run((t) => insertIn(t, u.id, co, "ok")));
        expect(result.role).toBe("MEMBER");
        expect((yield* db.readMembership(u.id, co))?.role).toBe("MEMBER");
      }),
    ));

  test("callback が typed failure を返すと rollback され、failure がそのまま E に載る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const u = yield* db.seedUser("fail");
        const co = yield* db.seedCompany("fail");
        const e = yield* Effect.flip(
          Transaction.use((tx) =>
            tx.run((t) =>
              Effect.gen(function* () {
                yield* insertIn(t, u.id, co, "fail");
                return yield* new Rejected({ why: "invariant" });
              }),
            ),
          ),
        );
        expect(e).toBeInstanceOf(Rejected);
        expect(yield* db.readMembership(u.id, co)).toBeUndefined();
      }),
    ));

  test("callback の defect も rollback され、Exit の cause に同一 object が載る", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const u = yield* db.seedUser("die");
        const co = yield* db.seedCompany("die");
        const boom = new Error("boom");
        const exit = yield* Effect.exit(
          Transaction.use((tx) =>
            tx.run((t) =>
              Effect.gen(function* () {
                yield* insertIn(t, u.id, co, "die");
                return yield* Effect.die(boom);
              }),
            ),
          ),
        );
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(boom);
        expect(yield* db.readMembership(u.id, co)).toBeUndefined();
      }),
    ));

  test("callback の外側の環境 (R) が tx 内の program に引き継がれる", () =>
    run(
      Effect.gen(function* () {
        class Greeting extends Data.TaggedError("Greeting")<{ readonly text: string }> {}
        const e = yield* Effect.flip(
          Transaction.use((tx) =>
            tx.run(() =>
              Effect.gen(function* () {
                // Transaction service 自身を tx 内から yield* できる = 外側の Context が渡っている
                yield* Transaction;
                return yield* new Greeting({ text: "hi" });
              }),
            ),
          ),
        );
        expect(e).toBeInstanceOf(Greeting);
      }),
    ));
});
