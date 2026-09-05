import { expect } from "bun:test";
import { Effect, Layer } from "effect";
import type { DbTx } from "@/db/transaction";
import { withWaitUntil } from "../background";
import { AppLayer, type AppServices } from "../runtime";
import { Transaction, TransactionLive } from "../transaction";
import { TestDb, testDbLayer } from "./test-db";

export type TestServices = AppServices | TestDb;

// DB 統合 test の唯一の runner: test 本体 (Effect.gen) を production の AppLayer + TestDb で走らせる。
// service を差し替える test は program 側で `Effect.provide(layer)` する (内側の provide が勝つ)。
// 失敗は呼び出し側が Effect.flip / exit で failure class として取り出す。
export const runTest =
  (prefix: string) =>
  <A, E>(program: Effect.Effect<A, E, TestServices>): Promise<A> =>
    Effect.runPromise(Effect.provide(Effect.provide(program, testDbLayer(prefix)), AppLayer));

// prefix ごとの runner と cleanup の組 (test file の定型)。
export const dbTest = (prefix: string) => {
  const run = runTest(prefix);
  return { run, cleanup: () => run(TestDb.use((db) => db.cleanup())) };
};

// use-case DB 統合テスト全体で共有する audit 行取得 (userId + eventType、createdAt 昇順)。
export const auditRowsFor = (userId: string, eventType: string) =>
  TestDb.use((db) => db.readAuditRows(userId, eventType));

// failure class の instanceof と wire code (error / status) をまとめて assert する。
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

// Transaction service 経由で tx を開き、tx を受ける helper (deleteAccountIfOrphaned 等) を走らせる。
export const inTx = <A, E, R>(f: (tx: DbTx) => Effect.Effect<A, E, R>) =>
  Transaction.use((tx) => tx.run(f));

// Background.run は fiber を detach するため、program が返った時点で background 処理は未着手。
// Workers と同じく waitUntil の collector で集めて完走を待つ (fire-and-forget の観測用)。
// callback 内は runThroughCallback と同じ技法 (Effect.context を取り runPromiseExitWith で別 root fiber として走らせる)。
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

// console.log を捕捉しつつ background を完走させる (local fallback のメール送信ログの観測用)。
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

// test Layer 用: service の shape は ports の全 method を要求するため、test は必要な method だけを渡し、
// 未実装の method は呼ばれた時点で defect にする (silent に undefined を返さない)。
export const partial = <T extends object>(impl: Partial<T>): T =>
  new Proxy(impl, {
    get: (target, key) =>
      key in target
        ? target[key as keyof T]
        : () => Effect.die(new Error(`test Layer: ${String(key)} は未実装`)),
  }) as T;

// Repository の live Layer が「存在しない行 → undefined」を返すことの確認 (各 domain の wiring.test.ts が共有)。
export const expectLiveMiss = async <A, E, R>(
  lookup: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R>,
): Promise<void> => {
  expect(await Effect.runPromise(Effect.provide(lookup, layer))).toBeUndefined();
};

// tx を「開いたか」を数える Transaction Layer。use-case の no-op 短絡 (tx を開かない) を観測する test 用。
// program 側で `Effect.provide(tx.layer)` して使う (AppLayer より先に効く)。
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
