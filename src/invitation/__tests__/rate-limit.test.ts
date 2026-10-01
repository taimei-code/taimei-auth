import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { expectFailure } from "../../__tests__/live-runner";
import { failingTtlStoreLayer } from "../../__tests__/test-layers";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import type { TtlStore } from "../../ttl-store-service";
import { SentryLive, type SentryService } from "../../sentry";
import { RateLimited } from "../errors";
import { consumeInvitationQuota } from "../rate-limit";
import { testKvStore, testTtlStoreLayer } from "../../__tests__/test-ttl-store";

// env は書き換えず bucket に先に値を入れる (env を変えると同 process の create.test.ts の既定 50 の前提が壊れる)。
const COMPANY = "invitation-rate-limit-test";
const bucketKey = () =>
  `invitation_rate:${COMPANY}:${new Date().toISOString().slice(0, "YYYY-MM-DDTHH".length)}`;

const clearBucket = async () => {
  for (const key of testKvStore.keys(`invitation_rate:${COMPANY}:`)) testKvStore.delete(key);
};

const run = <A, E>(
  p: Effect.Effect<A, E, TtlStore | SentryService>,
  ttlStore: Layer.Layer<TtlStore> = testTtlStoreLayer,
) => Effect.runPromise(Effect.provide(p, Layer.mergeAll(ttlStore, SentryLive)));

consumeInvitationQuota satisfies (
  companyId: string,
) => Effect.Effect<void, RateLimited, TtlStore | SentryService>;

describe("consumeInvitationQuota", () => {
  const captured = recordSentryExceptions();

  test("AC-024 / AC-025 計数不能 (TtlStoreError) は通し (fail-open)、Sentry に component 付きで 1 回記録する", async () => {
    const before = captured.length;
    expect(await run(consumeInvitationQuota(COMPANY), failingTtlStoreLayer)).toBeUndefined();
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("invitation-rate-limit");
  });
});

describe("consumeInvitationQuota (in-memory TTL store)", () => {
  beforeEach(clearBucket);
  afterAll(clearBucket);

  test("AC-026 / AC-028 49 hit 済みの bucket への 50 hit 目は通し、key は固定 window の書式で 1 つ", async () => {
    testKvStore.set(bucketKey(), "49", 3600);
    expect(await run(consumeInvitationQuota(COMPANY))).toBeUndefined();

    const keys = testKvStore.keys(`invitation_rate:${COMPANY}:`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^invitation_rate:invitation-rate-limit-test:\d{4}-\d{2}-\d{2}T\d{2}$/);
    const ttl = testKvStore.ttl(keys[0] as string);
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  test("AC-027 50 hit 済みの bucket への 51 hit 目は拒否する", async () => {
    testKvStore.set(bucketKey(), "50", 3600);
    const e = await run(Effect.flip(consumeInvitationQuota(COMPANY)));
    expectFailure(e, RateLimited, "rate_limited", 429);
  });
});
