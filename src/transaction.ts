import { Context, Effect, Exit, Layer } from "effect";
import type { DbTx } from "@/db/transaction";
import { runInTransaction } from "@/db/transaction";
import { DbError } from "./errors";

// drizzle は callback の throw でしか rollback しない。機構は ADR-0017「実装の機構」
class RollbackSignal<E> extends Error {
  constructor(readonly exit: Exit.Exit<never, E>) {
    super("transaction rolled back (Effect failure inside callback)");
    this.name = "RollbackSignal";
  }
}

const runThroughCallback = <A, E, R>(
  open: (
    run: (program: Effect.Effect<A, E, R>) => Promise<Exit.Exit<A, E>>,
  ) => Promise<Exit.Exit<A, E>>,
): Effect.Effect<A, E | DbError, R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const inside = async (program: Effect.Effect<A, E, R>): Promise<Exit.Exit<A, E>> => {
      const exit = await Effect.runPromiseExitWith(context)(program);
      if (Exit.isFailure(exit)) throw new RollbackSignal(exit as Exit.Exit<never, E>);
      return exit;
    };
    const exit = yield* Effect.tryPromise({
      try: () => open(inside),
      catch: (cause): unknown => cause,
    }).pipe(
      Effect.catch(
        (cause): Effect.Effect<Exit.Exit<A, E>, DbError> =>
          cause instanceof RollbackSignal
            ? Effect.succeed((cause as RollbackSignal<E>).exit as Exit.Exit<A, E>)
            : Effect.fail(new DbError({ cause })),
      ),
    );
    return yield* exit;
  });

export class Transaction extends Context.Service<
  Transaction,
  {
    run<A, E, R>(f: (tx: DbTx) => Effect.Effect<A, E, R>): Effect.Effect<A, E | DbError, R>;
  }
>()("taimei/Transaction") {}

export const TransactionLive = Layer.succeed(
  Transaction,
  Transaction.of({
    run: (f) => runThroughCallback((run) => runInTransaction((tx) => run(f(tx)))),
  }),
);
