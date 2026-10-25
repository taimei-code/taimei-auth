import { createHash, timingSafeEqual } from "node:crypto";
import { Effect, Schema } from "effect";

export function getValidServiceKeys(): string[] {
  const active = process.env.AUTH_SERVICE_KEY;
  const previous = process.env.AUTH_SERVICE_KEY_PREVIOUS;
  return [active, previous].filter((key): key is string => !!key);
}

export class ServiceKeyRejected extends Schema.TaggedError<ServiceKeyRejected>()(
  "ServiceKeyRejected",
  {},
  { httpApiStatus: 401 },
) {}

export class ServiceKeyMisconfigured extends Schema.TaggedError<ServiceKeyMisconfigured>()(
  "ServiceKeyMisconfigured",
  {},
  { httpApiStatus: 503 },
) {}

type ServiceKeyError = ServiceKeyRejected | ServiceKeyMisconfigured;

const sha256 = (value: string) => new Uint8Array(createHash("sha256").update(value).digest());

const matchesInConstantTime = (presented: string, accepted: readonly string[]): boolean => {
  const presentedDigest = sha256(presented);
  return accepted.some((key) => timingSafeEqual(sha256(key), presentedDigest));
};

export const verifyServiceKey = (
  presented: string | undefined,
): Effect.Effect<void, ServiceKeyError> =>
  Effect.suspend<void, ServiceKeyError, never>(() => {
    const accepted = getValidServiceKeys();
    if (accepted.length === 0) return new ServiceKeyMisconfigured();
    return presented && matchesInConstantTime(presented, accepted)
      ? Effect.void
      : new ServiceKeyRejected();
  });
