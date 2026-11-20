import type { Layer } from "effect";
import { initAuth } from "./auth";
import type { EmailSender } from "./email/ports";
import { type FeatureFlags, featureFlagsAllOff } from "./feature-flags";
import { MemoryKvStore } from "./kv-store.memory";
import { type AppRuntime, initRuntime } from "./runtime";
import { memoryBackend, type TtlStoreBackend } from "./ttl-store";

export function boot(
  ttlStore: TtlStoreBackend,
  featureFlags: Layer.Layer<FeatureFlags>,
  emailSender?: Layer.Layer<EmailSender>,
): AppRuntime {
  const runtime = initRuntime(ttlStore, featureFlags, emailSender);
  initAuth(runtime);
  return runtime;
}

export const bootInMemory = (emailSender?: Layer.Layer<EmailSender>): AppRuntime =>
  boot(memoryBackend(new MemoryKvStore()), featureFlagsAllOff(), emailSender);
