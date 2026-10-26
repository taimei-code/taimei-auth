import { Effect } from "effect";
import { MemoryKvStore } from "../kv-store.memory";
import { memoryBackend } from "../ttl-store";
import { betterAuthKey, type TtlKey } from "../ttl-key";
import { ttlStoreLayer } from "../ttl-store-service";

export const betterAuthKeyOf = (key: string): TtlKey => {
  const parsed = betterAuthKey(key);
  if (parsed === null) throw new Error(`better-auth の key の形でない: ${key}`);
  return parsed;
};

export const testKvStore = new MemoryKvStore();
export const testTtlStore = memoryBackend(testKvStore);
export const testTtlStoreLayer = ttlStoreLayer(testTtlStore);

export const storedSessionOf = (userId: string, token: string) =>
  Effect.sync(() => ({
    session: testKvStore.get(betterAuthKeyOf(token)) !== null,
    index: testKvStore.get(betterAuthKeyOf(`active-sessions-${userId}`)) !== null,
  }));

export const storedSessionsOf = (sessions: readonly { userId: string; token: string }[]) =>
  Effect.forEach(sessions, ({ userId, token }) => storedSessionOf(userId, token));
