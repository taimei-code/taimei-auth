import { Context, Effect, Fiber, Layer } from "effect";
import { AsyncLocalStorage } from "node:async_hooks";
import { captureCause, type SentryService } from "./sentry";

type WaitUntil = (promise: Promise<unknown>) => void;

const waitUntilStore = new AsyncLocalStorage<WaitUntil>();

export function withWaitUntil<T>(waitUntil: WaitUntil, fn: () => T): T {
  return waitUntilStore.run(waitUntil, fn);
}

export function runBackground(promise: Promise<unknown>): void {
  const waitUntil = waitUntilStore.getStore();
  if (waitUntil) waitUntil(promise);
}

const awaitInBackground = (fiber: Fiber.Fiber<unknown, unknown>) =>
  runBackground(Effect.runPromise(Fiber.await(fiber)));

const captureDefect = (defect: unknown) =>
  captureCause({ tags: { component: "background" } })({ cause: defect });

export class Background extends Context.Service<
  Background,
  {
    run<A, R>(effect: Effect.Effect<A, never, R>): Effect.Effect<void, never, R | SentryService>;
  }
>()("taimei/Background") {}

export const BackgroundLive = Layer.succeed(
  Background,
  Background.of({
    run: (effect) =>
      Effect.gen(function* () {
        const fiber = yield* Effect.forkDetach(effect.pipe(Effect.catchDefect(captureDefect)));
        awaitInBackground(fiber);
      }),
  }),
);
