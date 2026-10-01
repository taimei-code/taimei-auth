import { initAuth } from "./auth";
import { MemoryKvStore } from "./kv-store.memory";
import { type AppRuntime, initRuntime } from "./runtime";
import { memoryBackend, type TtlStoreBackend } from "./ttl-store";

export function boot(ttlStore: TtlStoreBackend): AppRuntime {
  const runtime = initRuntime(ttlStore);
  initAuth(runtime, ttlStore);
  return runtime;
}

export const bootInMemory = (): AppRuntime => boot(memoryBackend(new MemoryKvStore()));
