import { createHash, timingSafeEqual } from "node:crypto";
import { Data, Effect } from "effect";
import { isLocalEnvironment } from "./env";

export function getValidServiceKeys(): string[] {
  const active = process.env.AUTH_SERVICE_KEY;
  const previous = process.env.AUTH_SERVICE_KEY_PREVIOUS;
  return [active, previous].filter((key): key is string => !!key);
}

export class ServiceKeyRejected extends Data.TaggedError("ServiceKeyRejected") {
  readonly error = "Unauthorized: invalid service key" as const;
  readonly status = 401 as const;
}

export class ServiceKeyMisconfigured extends Data.TaggedError("ServiceKeyMisconfigured") {
  readonly error = "Service Key not configured (production)" as const;
  readonly status = 503 as const;
}

export type ServiceKeyError = ServiceKeyRejected | ServiceKeyMisconfigured;

const sha256 = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());

const matchesInConstantTime = (presented: string, accepted: readonly string[]): boolean => {
  const presentedDigest = sha256(presented);
  return accepted.some((key) => timingSafeEqual(sha256(key), presentedDigest));
};

export const verifyServiceKey = (
  presented: string | undefined,
): Effect.Effect<undefined, ServiceKeyError> =>
  Effect.suspend<undefined, ServiceKeyError, never>(() => {
    const accepted = getValidServiceKeys();
    if (accepted.length === 0) {
      if (!isLocalEnvironment()) return new ServiceKeyMisconfigured();
      console.warn(
        "AUTH_SERVICE_KEY is not configured. Skipping service auth (non-production only).",
      );
      return Effect.succeed(undefined);
    }
    return presented && matchesInConstantTime(presented, accepted)
      ? Effect.succeed(undefined)
      : new ServiceKeyRejected();
  });
