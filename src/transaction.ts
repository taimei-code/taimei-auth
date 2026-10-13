import { Context, Effect, Exit, Layer } from "effect";
import type { DbTx } from "@/db/transaction";
import { runInTransaction } from "@/db/transaction";
import { DbError } from "./errors";

// drizzle は callback が throw した時にしか rollback しない。
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

class AfterCommit extends Context.Service<
  AfterCommit,
  { register(effect: Effect.Effect<void>): Effect.Effect<void> }
>()("taimei/AfterCommit") {}

export const afterCommit = <R>(effect: Effect.Effect<void, never, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* AfterCommit.use((hooks) => hooks.register(Effect.provideContext(effect, context)));
  });

export class Transaction extends Context.Service<
  Transaction,
  {
    run<A, E, R>(
      f: (tx: DbTx) => Effect.Effect<A, E, R>,
    ): Effect.Effect<A, E | DbError, Exclude<R, AfterCommit>>;
  }
>()("taimei/Transaction") {}

const runCommittingHooks = <A, E, R>(
  f: (tx: DbTx) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DbError, Exclude<R, AfterCommit>> =>
  Effect.gen(function* () {
    const committed: Effect.Effect<void>[] = [];
    const hooks = AfterCommit.of({
      register: (effect) => Effect.sync(() => void committed.push(effect)),
    });
    const result = yield* runThroughCallback<A, E, Exclude<R, AfterCommit>>((run) =>
      runInTransaction((tx) => run(Effect.provideService(f(tx), AfterCommit, hooks))),
    );
    yield* Effect.all(committed, { discard: true });
    return result;
  });

export const TransactionLive = Layer.succeed(
  Transaction,
  Transaction.of({ run: runCommittingHooks }),
);
