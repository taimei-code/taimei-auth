import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { expectFailure } from "../../__tests__/live-runner";
import { failingTtlStoreLayer } from "../../__tests__/test-layers";
import { recordSentry } from "../../__tests__/sentry-recorder";
import type { TtlStore } from "../../ttl-store-service";
import { SentryLive, type SentryService } from "../../sentry";
import { RateLimited } from "../../failures";
import { spendInvitationAttempt } from "../attempt-budget";
import { testKvStore, testTtlStoreLayer } from "../../__tests__/test-ttl-store";

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

spendInvitationAttempt satisfies (
  companyId: string,
) => Effect.Effect<void, RateLimited, TtlStore | SentryService>;

describe("spendInvitationAttempt", () => {
  const { exceptions: captured } = recordSentry();

  test("計数不能 (TtlStoreError) は通し (fail-open)、Sentry に component 付きで 1 回記録する", async () => {
    const before = captured.length;
    expect(await run(spendInvitationAttempt(COMPANY), failingTtlStoreLayer)).toBeUndefined();
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("invitation-rate-limit");
  });
});

describe("spendInvitationAttempt (in-memory TTL store)", () => {
  beforeEach(clearBucket);
  afterAll(clearBucket);

  test("49 hit 済みの bucket への 50 hit 目は通し、key は固定 window の書式で 1 つ", async () => {
    testKvStore.set(bucketKey(), "49", 3600);
    expect(await run(spendInvitationAttempt(COMPANY))).toBeUndefined();

    const keys = testKvStore.keys(`invitation_rate:${COMPANY}:`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^invitation_rate:invitation-rate-limit-test:\d{4}-\d{2}-\d{2}T\d{2}$/);
    const ttl = testKvStore.ttl(keys[0] as string);
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  test("50 hit 済みの bucket への 51 hit 目は拒否する", async () => {
    testKvStore.set(bucketKey(), "50", 3600);
    const e = await run(Effect.flip(spendInvitationAttempt(COMPANY)));
    expectFailure(e, RateLimited);
  });
});

describe("招待の試行枠の上限は env で変えられる", () => {
  const previous = process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY;
  beforeEach(clearBucket);
  afterAll(async () => {
    if (previous === undefined) delete process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY;
    else process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY = previous;
    await clearBucket();
  });

  test("INVITATION_HOURLY_LIMIT_PER_COMPANY が 2 なら、同じ事業所の 3 回目の招待は RateLimited になる", async () => {
    process.env.INVITATION_HOURLY_LIMIT_PER_COMPANY = "2";
    expect(await run(spendInvitationAttempt(COMPANY))).toBeUndefined();
    expect(await run(spendInvitationAttempt(COMPANY))).toBeUndefined();
    expectFailure(await run(Effect.flip(spendInvitationAttempt(COMPANY))), RateLimited);
  });
});
