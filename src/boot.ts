import type { Layer } from "effect";
import { initAuth } from "./auth";
import type { EmailSender } from "./email/ports";
import { MemoryKvStore } from "./kv-store.memory";
import { type AppRuntime, initRuntime } from "./runtime";
import { memoryBackend, type TtlStoreBackend } from "./ttl-store";

export function boot(
  ttlStore: TtlStoreBackend,
  emailSender?: Layer.Layer<EmailSender>,
): AppRuntime {
  const runtime = initRuntime(ttlStore, emailSender);
  initAuth(runtime, ttlStore);
  return runtime;
}

export const bootInMemory = (emailSender?: Layer.Layer<EmailSender>): AppRuntime =>
  boot(memoryBackend(new MemoryKvStore()), emailSender);
