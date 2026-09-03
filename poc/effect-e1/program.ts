// PoC (案 E1): Effect v4 の各構造を越えて AsyncLocalStorage の store が保持されるか、drizzle の
// per-request Pool / transaction が Effect.tryPromise の内側から動くかを観測する共有 program。
// worker.ts (workerd) と run-bun.ts / program.test.ts (Bun) の両 runtime から同じものを走らせる。
import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import { Context, Effect, Fiber, Layer, ManagedRuntime, Schedule, Schema } from "effect";
import { db } from "../../db/client";
import { lockUserForCompanyCreation } from "../../db/repositories/membership";
import { type DbOrTx, runInTransaction } from "../../db/transaction";

// request 固有値を運ぶ ALS。db/client.ts の requestPoolStore と同じ仕組みを観測用に複製する。
export const reqStore = new AsyncLocalStorage<string>();

export class PocFailure extends Schema.TaggedError<PocFailure>()("PocFailure", {
  step: Schema.String,
}) {}

// I/O を持たない service。module-level ManagedRuntime に載せる (workerd では dispose 契機が無いため
// Layer に I/O resource を置かない制約を守る)。
export class Tagger extends Context.Service<
  Tagger,
  { readonly tag: (step: string) => Effect.Effect<string> }
>()("poc/Tagger") {
  static readonly layer = Layer.succeed(Tagger)({
    tag: (step) => Effect.sync(() => `${step}:${reqStore.getStore() ?? "none"}`),
  });
}

export const runtime = ManagedRuntime.make(Tagger.layer);

export type Observation = {
  readonly step: string;
  readonly store: string | undefined;
  readonly ok: boolean;
  readonly extra?: unknown;
};

const observe = (step: string, expected: string, extra?: unknown): Observation => {
  const store = reqStore.getStore();
  return { step, store, ok: store === expected, extra };
};

async function backendPid(exec: DbOrTx): Promise<number> {
  const result = await exec.execute(sql`SELECT pg_backend_pid() AS pid`);
  return Number((result.rows[0] as { pid: number | string }).pid);
}

export const program = (id: string) =>
  Effect.gen(function* () {
    const obs: Observation[] = [];
    const tagger = yield* Tagger;
    obs.push(observe("sync-start", id));
    const tagged = yield* tagger.tag("service");
    obs.push({ step: "service-layer", store: tagged, ok: tagged === `service:${id}` });

    // drizzle → RoutingPool → ALS の request pool を Effect.tryPromise の内側から使う
    const pid = yield* Effect.tryPromise({
      try: () => backendPid(db),
      catch: () => new PocFailure({ step: "query" }),
    });
    obs.push(observe("after-tryPromise", id, { pid }));

    // Effect scheduler の timer 経由で再開
    yield* Effect.sleep(10);
    obs.push(observe("after-sleep", id));

    // 子 fiber の内側と join 後
    const fiber = yield* Effect.forkChild(
      Effect.gen(function* () {
        yield* Effect.sleep(5);
        return observe("inside-forkChild", id);
      }),
    );
    obs.push(yield* Fiber.join(fiber));
    obs.push(observe("after-join", id));

    // 並行 2 本の I/O
    const pair = yield* Effect.all(
      [
        Effect.tryPromise(() => backendPid(db)).pipe(
          Effect.map((p) => observe("all-1", id, { pid: p })),
        ),
        Effect.tryPromise(() => backendPid(db)).pipe(
          Effect.map((p) => observe("all-2", id, { pid: p })),
        ),
      ],
      { concurrency: 2 },
    );
    obs.push(...pair);

    // 1 回失敗して retry
    let attempts = 0;
    yield* Effect.suspend(() => {
      attempts += 1;
      return attempts < 2 ? Effect.fail(new PocFailure({ step: "retry" })) : Effect.void;
    }).pipe(Effect.retry({ schedule: Schedule.recurs(1) }));
    obs.push(observe("after-retry", id, { attempts }));

    // 既存の runInTransaction + advisory lock を Promise のまま包む (案 R1)。tx 内の接続 pinning を pid で見る
    const tx = yield* Effect.tryPromise({
      try: () =>
        runInTransaction(async (t) => {
          await lockUserForCompanyCreation(t, id);
          const a = await backendPid(t);
          const b = await backendPid(t);
          return { a, b, store: reqStore.getStore() };
        }),
      catch: () => new PocFailure({ step: "tx" }),
    });
    obs.push({ step: "tx-pinned", store: tx.store, ok: tx.store === id && tx.a === tx.b, extra: tx });

    // callback 型 API
    yield* Effect.callback<void>((resume) => {
      const t = setTimeout(() => resume(Effect.void), 5);
      return Effect.sync(() => clearTimeout(t));
    });
    obs.push(observe("after-callback", id));

    return { id, pid, ok: obs.every((o) => o.ok), obs };
  });

// response 後に ctx.waitUntil で完走させる background task。DB は触らず ALS の store だけ観測する。
export const backgroundTask = (id: string, onDone: (o: Observation) => void) =>
  Effect.gen(function* () {
    yield* Effect.sleep(30);
    onDone(observe("background", id));
  });
