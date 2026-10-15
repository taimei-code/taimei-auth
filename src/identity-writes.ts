import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import type { TtlStoreBackend } from "./ttl-store";

type WriteTracker = { dirty: boolean; invalidations: number; failures: number };

const tracker = new AsyncLocalStorage<WriteTracker>();

const IDENTITY_WRITE = /^\s*(insert\s+into|update|delete\s+from)\s+"?(user|membership|company)"?[\s(]/i;

const queryText = (arg: unknown): string =>
  typeof arg === "string"
    ? arg
    : typeof arg === "object" && arg !== null && "text" in arg && typeof arg.text === "string"
      ? arg.text
      : "";

const markDirty = () => {
  const current = tracker.getStore();
  if (current) current.dirty = true;
};

const instrumented = new WeakSet<PoolClient>();

export const trackIdentityWrites = (pool: Pool) => {
  pool.on("connect", (client) => {
    if (instrumented.has(client)) return;
    instrumented.add(client);
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args) => {
      if (IDENTITY_WRITE.test(queryText(args[0]))) markDirty();
      return original(...args);
    };
  });
};

export const markDirtyOnSessionDelete = (backend: TtlStoreBackend): TtlStoreBackend => ({
  ...backend,
  delete: async (key) => {
    markDirty();
    return backend.delete(key);
  },
});

type Edge = { invalidateAll(): Promise<number> };

const invalidate = async (edge: Edge | undefined, state: WriteTracker) => {
  if (!state.dirty || !edge) return;
  state.dirty = false;
  try {
    await edge.invalidateAll();
    state.invalidations++;
  } catch (error) {
    state.failures++;
    console.error("[identity-writes] read model invalidation failed", error);
  }
};

export const withIdentityWrites = async <A>(
  edge: Edge | undefined,
  run: (afterBackground: (settled: Promise<unknown>) => Promise<unknown>) => Promise<A>,
): Promise<A> => {
  const state: WriteTracker = { dirty: false, invalidations: 0, failures: 0 };
  return tracker.run(state, async () => {
    const result = await run((settled) => settled.then(() => invalidate(edge, state)));
    await invalidate(edge, state);
    return result;
  });
};

export const isIdentityWrite = (sql: string) => IDENTITY_WRITE.test(sql);
