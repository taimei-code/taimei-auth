import { MemoryKvStore } from "../kv-store.memory";
import { memoryBackend } from "../ttl-store";
import { ttlStoreLayer } from "../ttl-store-service";

export const testKvStore = new MemoryKvStore();
export const testTtlStore = memoryBackend(testKvStore);
export const testTtlStoreLayer = ttlStoreLayer(testTtlStore);
