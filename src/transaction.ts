import { Context, Effect, Exit, Layer } from "effect";
import type { DbTx } from "@/db/transaction";
import { runInTransaction } from "@/db/transaction";
import { DbError } from "./errors";

// Transaction service (ADR-0017 Decision の tx 項): drizzle の tx (Promise callback) の中で Effect program を走らせる。
// 不変条件: tx 内の failure (Fail) と defect (Die) は常に rollback する。drizzle は callback が throw した時だけ
// rollback するため、Exit が失敗なら sentinel (RollbackSignal) を throw して rollback を引き、外側で元の Exit に
// 復元する。旧 accept.ts の RejectAccept / withOwnerLockGuard の OwnerInvariantViolation と同じ意味論を 1 箇所に隠す。

export class RollbackSignal<E> extends Error {
  constructor(readonly exit: Exit.Exit<never, E>) {
    super("transaction rolled back (Effect failure inside callback)");
    this.name = "RollbackSignal";
  }
}

// Promise callback API (tx / lock guard) の中で program を走らせ、結果の Exit を Effect に戻す。
// callback 内で失敗した program は RollbackSignal を throw して rollback を引き、ここで元の Exit に復元する。
// それ以外の throw (drizzle / pg / lock guard 自身) は mapError で failure class に写像する。
// callback 内の program は runPromiseExitWith で別の root fiber として走るため、外側の fiber が interrupt
// されても callback は止まらず commit まで進む (Fail / Die だけが rollback の契機)。tx を timeout や
// 並列失敗の interrupt で切る呼び出し元は現在無い (ADR-0017 Consequences)。
export const runThroughCallback = <A, E, R, Err>(
  open: (
    run: (program: Effect.Effect<A, E, R>) => Promise<Exit.Exit<A, E>>,
  ) => Promise<Exit.Exit<A, E>>,
  mapError: (cause: unknown) => Err,
): Effect.Effect<A, E | Err, R> =>
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
        (cause): Effect.Effect<Exit.Exit<A, E>, Err> =>
          cause instanceof RollbackSignal
            ? Effect.succeed((cause as RollbackSignal<E>).exit as Exit.Exit<A, E>)
            : Effect.fail(mapError(cause)),
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
    run: (f) =>
      runThroughCallback(
        (run) => runInTransaction((tx) => run(f(tx))),
        (cause) => new DbError({ cause }),
      ),
  }),
);
