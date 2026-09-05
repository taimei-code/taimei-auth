import { expect } from "bun:test";
import { Effect, type Layer } from "effect";
import type { DbTx } from "@/db/transaction";
import { AppLayer, type AppServices } from "../runtime";
import { Transaction } from "../transaction";

// use-case / domain の DB 統合テスト用: production の AppLayer (live ports) で program を走らせる。
// 失敗を class として取り出すときは flipLive。
export const runLive = <A, E>(program: Effect.Effect<A, E, AppServices>): Promise<A> =>
  Effect.runPromise(Effect.provide(program, AppLayer));

export const flipLive = <A, E>(program: Effect.Effect<A, E, AppServices>): Promise<E> =>
  Effect.runPromise(Effect.flip(Effect.provide(program, AppLayer)));

// Transaction service 経由で tx を開き、tx を受ける helper (deleteAccountIfOrphaned 等) を走らせる。
export const runInTx = <A, E>(f: (tx: DbTx) => Effect.Effect<A, E, AppServices>): Promise<A> =>
  runLive(Transaction.use((tx) => tx.run(f)));

// 旧 use-case の Result 形 ({ ok, reason }) に写像する。既存 DB 統合テストの assertion を保つための shim で、
// failure class の `error` (wire code) が旧 reason literal と一致することも同時に検査している。
export const runLiveResult = <A, E>(
  program: Effect.Effect<A, E, AppServices>,
): Promise<
  ({ ok: true } & (A extends object ? A : Record<never, never>)) | { ok: false; reason: string }
> =>
  Effect.runPromise(
    Effect.provide(
      Effect.match(program, {
        onFailure: (e) => ({
          ok: false as const,
          reason:
            (e as { error?: string; _tag?: string }).error ??
            (e as { _tag?: string })._tag ??
            String(e),
        }),
        onSuccess: (a) =>
          ({ ok: true as const, ...(typeof a === "object" && a !== null ? a : {}) }) as {
            ok: true;
          } & (A extends object ? A : Record<never, never>),
      }),
      AppLayer,
    ),
  );

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
