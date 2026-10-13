import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Cause, Data, Effect, Exit } from "effect";
import type { DbTx } from "@/db/transaction";
import { MembershipRepo } from "../membership/ports";
import { afterCommit, Transaction } from "../transaction";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

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
                yield* Transaction;
                return yield* new Greeting({ text: "hi" });
              }),
            ),
          ),
        );
        expect(e).toBeInstanceOf(Greeting);
      }),
    ));

  test("commit が成功すると、tx の中で登録した effect を commit の後に登録順で実行する", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const u = yield* db.seedUser("after-commit");
        const co = yield* db.seedCompany("after-commit");
        const seen: string[] = [];
        const record = (label: string) =>
          db.readMembership(u.id, co).pipe(
            Effect.orDie,
            Effect.map((row) => seen.push(`${label}:${row ? "committed" : "absent"}`)),
            Effect.asVoid,
          );
        yield* Transaction.use((tx) =>
          tx.run((t) =>
            insertIn(t, u.id, co, "after-commit").pipe(
              Effect.tap(() => afterCommit(record("first"))),
              Effect.tap(() => afterCommit(record("second"))),
            ),
          ),
        );
        expect(seen).toEqual(["first:committed", "second:committed"]);
      }),
    ));

  test("rollback した tx で登録した effect は実行しない", () =>
    run(
      Effect.gen(function* () {
        let ran = 0;
        const exit = yield* Effect.exit(
          Transaction.use((tx) =>
            tx.run(() =>
              afterCommit(Effect.sync(() => void ran++)).pipe(
                Effect.andThen(new Rejected({ why: "rollback" })),
              ),
            ),
          ),
        );
        expect([Exit.isFailure(exit), ran]).toEqual([true, 0]);
        yield* Transaction.use((tx) => tx.run(() => afterCommit(Effect.sync(() => void ran++))));
        expect(ran).toBe(1);
      }),
    ));
});
