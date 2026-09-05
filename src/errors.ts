import { Data, type Duration, Effect } from "effect";

// 境界 error (ADR-0017 Decision の boundary error 項): サードパーティ (drizzle / better-auth / Redis) の
// 失敗は型を制御できないため、元の値を cause: unknown として保ったまま Effect の E channel に載せる。
// adapter (runRoute / runRpc) は cause そのものを Sentry に渡し (grouping 不変)、wire には 500 だけを出す。

// Data.TaggedError を使う (Schema.TaggedError でない)。理由 (decode / encode 経路の不在と bundle 増分) の正本は
// ADR-0017 Decision の failure 項。yield* / catchTag の使い勝手は同じ。
export class DbError extends Data.TaggedError("DbError")<{ readonly cause: unknown }> {}

export class AuthApiError extends Data.TaggedError("AuthApiError")<{ readonly cause: unknown }> {}

export class RedisError extends Data.TaggedError("RedisError")<{ readonly cause: unknown }> {}

export class EmailError extends Data.TaggedError("EmailError")<{ readonly cause: unknown }> {}

export type BoundaryError = DbError | AuthApiError | RedisError | EmailError;

// adapter (runRoute / runRpc) が「wire に出さず Sentry(cause) → 500 にする failure」を判定する唯一の述語。
export const isBoundaryError = (e: unknown): e is BoundaryError =>
  e instanceof DbError ||
  e instanceof AuthApiError ||
  e instanceof RedisError ||
  e instanceof EmailError;

// Promise を返す境界呼び出しを boundary error に写像する。thunk の同期 throw も E に載せる
// (Effect.tryPromise の仕様) ので、旧 guard の「Promise.resolve().then() で包む」fail-open 回避は不要になる。
const tryBoundary =
  <Err>(wrap: (cause: unknown) => Err) =>
  <A>(thunk: () => Promise<A>): Effect.Effect<A, Err> =>
    Effect.tryPromise({ try: thunk, catch: wrap });

export const tryDb = tryBoundary((cause) => new DbError({ cause }));
export const tryAuthApi = tryBoundary((cause) => new AuthApiError({ cause }));
export const tryRedis = tryBoundary((cause) => new RedisError({ cause }));
export const tryEmail = tryBoundary((cause) => new EmailError({ cause }));

// Promise を返す関数を Effect face に持ち上げる (liftAll の内部実装)。引数と戻り値の型は元の関数から導出し、
// 失敗は DbError (cause: unknown) に載せる。
type Lifted<F extends (...args: never[]) => Promise<unknown>> = (
  ...args: Parameters<F>
) => Effect.Effect<Awaited<ReturnType<F>>, DbError>;

const liftDb =
  <F extends (...args: never[]) => Promise<unknown>>(fn: F): Lifted<F> =>
  (...args) =>
    tryDb(() => fn(...args) as Promise<Awaited<ReturnType<F>>>);

// Promise module (db/repositories の名前空間 import、db/testing の seed object) をまるごと Effect 面に持ち上げる
// 型と実装。ports は LiftedModule<typeof repo> を service 型に、wiring は liftAll(repo) を live にする
// (port の method 名 = repository の関数名。method 名を 2 度書かない)。
// 型は Promise を返す関数だけを写す。
export type LiftedModule<M> = {
  [K in keyof M as M[K] extends (...args: never[]) => Promise<unknown> ? K : never]: M[K] extends (
    ...args: never[]
  ) => Promise<unknown>
    ? Lifted<M[K]>
    : never;
};

// 実行時は Promise 判定をせず全関数を包む (戻り値は実行前に判定できない。型に無い key は到達できない)。
export const liftAll = <M extends object>(module: M): LiftedModule<M> =>
  Object.fromEntries(
    Object.entries(module).flatMap(([key, value]) =>
      typeof value === "function"
        ? [[key, liftDb(value as (...args: never[]) => Promise<unknown>)]]
        : [],
    ),
  ) as LiftedModule<M>;

// timeout (Cause.TimeoutError) を境界 error に畳む: 呼び出し側は「その境界の障害」として 1 種類だけ catch すればよい。
export const timeoutAsBoundary =
  <Err>(wrap: (cause: unknown) => Err, duration: Duration.Input) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | Err, R> =>
    effect.pipe(
      Effect.timeout(duration),
      Effect.catchTag("TimeoutError", (timeout) => Effect.fail(wrap(timeout))),
    );
