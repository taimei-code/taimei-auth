import { Context, Effect, Fiber, Layer } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";

// 背景タスク (audit log / welcome email 等) を runtime 横断で走らせる。Workers は response 後の未解決
// promise を "hung" として cancel するため ctx.waitUntil に登録し、ALS で per-request に伝播する (ADR-0011)。
type WaitUntil = (promise: Promise<unknown>) => void;

const waitUntilStore = new AsyncLocalStorage<WaitUntil>();

// worker entry が fetch 処理全体をこの中で走らせ、ctx.waitUntil を per-request に束縛する。
export function withWaitUntil<T>(waitUntil: WaitUntil, fn: () => T): T {
  return waitUntilStore.run(waitUntil, fn);
}

// promise は呼出側で生成・.catch 済みの前提。Workers は ctx.waitUntil で完走を保証し、Bun/Node は
// fire-and-forget (process 終了時の取りこぼしは監査ログが critical path でないため許容)。
export function runBackground(promise: Promise<unknown>): void {
  const waitUntil = waitUntilStore.getStore();
  if (waitUntil) waitUntil(promise);
}

// Effect service 版 (ADR-0017 Stage 4)。program は `Background.run(effect)` で background 処理を切り離す。
// fiber を detach し、その完了 Promise を上の ALS carrier (runBackground) に登録する。Workers では worker entry が
// 全 background の完走を待って pool を閉じ、Bun では fire-and-forget (従来どおり)。
export class Background extends Context.Service<
  Background,
  {
    // fork は親 fiber の context を継承するため、program の requirement (R) はそのまま呼び出し側に載る。
    run<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<void, never, R>;
  }
>()("taimei/Background") {}

export const BackgroundLive = Layer.succeed(
  Background,
  Background.of({
    run: (effect) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(effect);
        // Fiber.await は失敗しない (Exit を返す)。effect 自身の失敗は呼び出し側が catch 済みの前提 (旧 runBackground と同じ)。
        runBackground(Effect.runPromise(Fiber.await(fiber)));
      }),
  }),
);
