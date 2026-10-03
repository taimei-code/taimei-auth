import { Effect } from "effect";
import { MemoryKvStore } from "../kv-store.memory";
import { memoryBackend } from "../ttl-store";
import { ttlStoreLayer } from "../ttl-store-service";

export const testKvStore = new MemoryKvStore();
export const testTtlStore = memoryBackend(testKvStore);
export const testTtlStoreLayer = ttlStoreLayer(testTtlStore);

export const storedSessionOf = (userId: string, token: string) =>
  Effect.sync(() => ({
    session: testKvStore.get(token) !== null,
    index: testKvStore.get(`active-sessions-${userId}`) !== null,
  }));

export const storedSessionsOf = (sessions: readonly { userId: string; token: string }[]) =>
  Effect.forEach(sessions, ({ userId, token }) => storedSessionOf(userId, token));
