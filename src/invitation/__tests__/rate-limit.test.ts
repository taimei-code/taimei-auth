import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { failingRedisLayer } from "../../__tests__/test-layers";
import { recordSentryExceptions } from "../../__tests__/sentry-recorder";
import { getRedis } from "../../redis";
import { type Redis, RedisLive } from "../../redis-service";
import { SentryLive, type SentryService } from "../../sentry";
import { tryConsumeInvitationQuota } from "../rate-limit";

// company 単位の invitation 試行枠 (設計 AC-024〜AC-029)。倒し方は fail-open。
// 上限は env の既定 50 を前提に、env を書き換えず bucket に pre-set して観測する
// (env を変えると同 process で後続する create.test.ts の既定 50 前提を壊す)。
const COMPANY = "invitation-rate-limit-test";
const bucketKey = () =>
  `invitation_rate:${COMPANY}:${new Date().toISOString().slice(0, "YYYY-MM-DDTHH".length)}`;

const clearBucket = async () => {
  const r = await getRedis();
  const keys = await r.keys(`invitation_rate:${COMPANY}:*`);
  if (keys.length) await r.del(keys);
};

const run = <A, E>(
  p: Effect.Effect<A, E, Redis | SentryService>,
  redis: Layer.Layer<Redis> = RedisLive,
) => Effect.runPromise(Effect.provide(p, Layer.mergeAll(redis, SentryLive)));

// AC-029: E channel は never のまま (kernel が RedisError を畳む)。
tryConsumeInvitationQuota satisfies (
  companyId: string,
) => Effect.Effect<boolean, never, Redis | SentryService>;

describe("tryConsumeInvitationQuota", () => {
  const captured = recordSentryExceptions();

  test("AC-024 / AC-025 計数不能 (RedisError) は通し (fail-open)、Sentry に component 付きで 1 回記録する", async () => {
    const before = captured.length;
    expect(await run(tryConsumeInvitationQuota(COMPANY), failingRedisLayer)).toBe(true);
    expect(captured.length).toBe(before + 1);
    expect(captured.at(-1)?.[1]?.tags?.component).toBe("invitation-rate-limit");
  });
});

describe("tryConsumeInvitationQuota (live Redis)", () => {
  beforeEach(clearBucket);
  afterAll(clearBucket);

  test("AC-026 / AC-028 49 hit 済みの bucket への 50 hit 目は通し、key は固定 window の書式で 1 つ", async () => {
    const r = await getRedis();
    await r.set(bucketKey(), "49", { EX: 3600 });
    expect(await run(tryConsumeInvitationQuota(COMPANY))).toBe(true);

    const keys = await r.keys(`invitation_rate:${COMPANY}:*`);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^invitation_rate:invitation-rate-limit-test:\d{4}-\d{2}-\d{2}T\d{2}$/);
    const ttl = await r.ttl(keys[0] as string);
    expect(ttl).toBeGreaterThanOrEqual(1);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  test("AC-027 50 hit 済みの bucket への 51 hit 目は拒否する", async () => {
    await (await getRedis()).set(bucketKey(), "50", { EX: 3600 });
    expect(await run(tryConsumeInvitationQuota(COMPANY))).toBe(false);
  });
});
