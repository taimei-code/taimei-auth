import { expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { DbTx } from "@/db/transaction";
import { withWaitUntil } from "../background";
import { AppLayer, type AppServices } from "../runtime";
import { Transaction, TransactionLive } from "../transaction";
import { TestDb, testDbLayer } from "./test-db";

type TestServices = AppServices | TestDb;

// service を差し替えるテストは program 側で `Effect.provide(layer)` する (内側の provide が勝つ)。
export const runTest =
  (prefix: string) =>
  <A, E>(program: Effect.Effect<A, E, TestServices>): Promise<A> =>
    Effect.runPromise(Effect.provide(Effect.provide(program, testDbLayer(prefix)), AppLayer));

export const dbTest = (prefix: string) => {
  const run = runTest(prefix);
  return { run, cleanup: () => run(TestDb.use((db) => db.cleanup())) };
};

export const auditRowsFor = (userId: string, eventType: string) =>
  TestDb.use((db) => db.readAuditRows(userId, eventType));

export const expectFailure = (
  e: unknown,
  cls: new () => { error: string; status: number },
  code: string,
  status: number,
): void => {
  expect(e).toBeInstanceOf(cls);
  const f = e as { error: string; status: number };
  expect([f.error, f.status]).toEqual([code, status]);
};

export const inTx = <A, E, R>(f: (tx: DbTx) => Effect.Effect<A, E, R>) =>
  Transaction.use((tx) => tx.run(f));

// Background.run は fiber を detach するため、waitUntil の collector で集めて完走を待つ。
export const drained = <A, E, R>(program: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const pending: Promise<unknown>[] = [];
    const exit = yield* Effect.promise(async () => {
      const exit = await withWaitUntil(
        (promise) => {
          pending.push(promise);
        },
        () => Effect.runPromiseExitWith(context)(program),
      );
      await Promise.allSettled(pending);
      return exit;
    });
    return yield* exit;
  });

export const observing = <A, E, R>(
  program: Effect.Effect<A, E, R>,
): Effect.Effect<{ value: A; logs: string[] }, E, R> =>
  Effect.gen(function* () {
    const logs: string[] = [];
    const value = yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const original = console.log;
        console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
        return original;
      }),
      () => drained(program),
      (original) =>
        Effect.sync(() => {
          console.log = original;
        }),
    );
    return { value, logs };
  });

// spy の restore は Effect の release で必ず行う (Bun の mockRestore は呼び出し履歴も消す)。
export const withSpy = <S extends { mockRestore(): void }, A, E, R>(
  install: () => S,
  use: (spy: S) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(Effect.sync(install), use, (spy) =>
    Effect.sync(() => spy.mockRestore()),
  );

export const partial = <T extends object>(impl: Partial<T>): T =>
  new Proxy(impl, {
    get: (target, key) =>
      key in target
        ? target[key as keyof T]
        : () => Effect.die(new Error(`test Layer: ${String(key)} は未実装`)),
  }) as T;

export const expectLiveMiss = async <A, E, R>(
  lookup: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R>,
): Promise<void> => {
  expect(await Effect.runPromise(Effect.provide(lookup, layer))).toBeUndefined();
};

export const recordingTransaction = (): {
  layer: Layer.Layer<Transaction>;
  readonly calls: { n: number };
} => {
  const calls = { n: 0 };
  const layer = Layer.effect(
    Transaction,
    Effect.map(Transaction, (live) =>
      Transaction.of({
        run: (f) =>
          Effect.suspend(() => {
            calls.n += 1;
            return live.run(f);
          }),
      }),
    ),
  ).pipe(Layer.provide(TransactionLive));
  return { layer, calls };
};
