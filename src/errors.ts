import { Data, type Duration, Effect } from "effect";

export class DbError extends Data.TaggedError("DbError")<{ readonly cause: unknown }> {}

export class AuthApiError extends Data.TaggedError("AuthApiError")<{ readonly cause: unknown }> {}

export class TtlStoreError extends Data.TaggedError("TtlStoreError")<{ readonly cause: unknown }> {}

export class EmailError extends Data.TaggedError("EmailError")<{ readonly cause: unknown }> {}

export type BoundaryError = DbError | AuthApiError | TtlStoreError | EmailError;

export const isBoundaryError = (e: unknown): e is BoundaryError =>
  e instanceof DbError ||
  e instanceof AuthApiError ||
  e instanceof TtlStoreError ||
  e instanceof EmailError;

const tryBoundary =
  <Err>(wrap: (cause: unknown) => Err) =>
  <A>(thunk: () => Promise<A>): Effect.Effect<A, Err> =>
    Effect.tryPromise({ try: thunk, catch: wrap });

export const tryDb = tryBoundary((cause) => new DbError({ cause }));
export const tryAuthApi = tryBoundary((cause) => new AuthApiError({ cause }));
export const tryTtlStore = tryBoundary((cause) => new TtlStoreError({ cause }));
export const tryEmail = tryBoundary((cause) => new EmailError({ cause }));

type Lifted<F extends (...args: never[]) => Promise<unknown>> = (
  ...args: Parameters<F>
) => Effect.Effect<Awaited<ReturnType<F>>, DbError>;

const liftDb =
  <F extends (...args: never[]) => Promise<unknown>>(fn: F): Lifted<F> =>
  (...args) =>
    tryDb(() => fn(...args) as Promise<Awaited<ReturnType<F>>>);

export type LiftedModule<M> = {
  [K in keyof M as M[K] extends (...args: never[]) => Promise<unknown> ? K : never]: M[K] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? Lifted<M[K]>
    : never;
};

export const liftAll = <M extends object>(module: M): LiftedModule<M> =>
  Object.fromEntries(
    Object.entries(module).flatMap(([key, value]) =>
      typeof value === "function"
        ? [[key, liftDb(value as (...args: never[]) => Promise<unknown>)]]
        : [],
    ),
  ) as LiftedModule<M>;

export const timeoutAsBoundary =
  <Err>(wrap: (cause: unknown) => Err, duration: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | Err, R> =>
    effect.pipe(
      Effect.timeout(duration),
      Effect.catchTag("TimeoutError", (timeout) => Effect.fail(wrap(timeout))),
    );
