import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getRedis } from "../../redis";
import { runTest, inTx } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { deleteAccountIfOrphaned } from "../orphan";

const P = "orphan-test-";
const run = runTest(P);

const redis = () => Effect.promise(() => getRedis());

const cleanup = () =>
  run(
    Effect.gen(function* () {
      yield* (yield* TestDb).cleanup();
      const r = yield* redis();
      yield* Effect.promise(() =>
        r.del([
          `${P}rtok-1`,
          `${P}rtok-2`,
          `active-sessions-${P}u-redis`,
          `${P}rtok-kept`,
          `active-sessions-${P}u-rkept`,
        ]),
      );
    }),
  );

const seedUser = (suffix: string) =>
  Effect.gen(function* () {
    const db = yield* TestDb;
    const u = yield* db.seedUser(suffix, { emailVerified: false });
    yield* db.seedSession(u.id, suffix);
    return u.id;
  });

// better-auth secondaryStorage の実保存形状を再現する: session 実体は token 文字列キー、
// user の生存 session 一覧は active-sessions-{userId} (deleteUserSessions が読む索引)。
const seedRedisSessions = (userId: string, tokens: string[]) =>
  Effect.promise(async () => {
    const r = await getRedis();
    const expiresAt = Date.now() + 86_400_000;
    for (const token of tokens) {
      await r.set(token, JSON.stringify({ session: { token, userId, expiresAt }, user: {} }));
    }
    await r.set(
      `active-sessions-${userId}`,
      JSON.stringify(tokens.map((token) => ({ token, expiresAt }))),
    );
  });

const redisGet = (key: string) =>
  redis().pipe(Effect.flatMap((r) => Effect.promise(() => r.get(key))));

const countAccountDeleteAudit = (userId: string) =>
  TestDb.use((db) => db.readAuditRows(userId, "account_delete")).pipe(
    Effect.map((rows) => rows.length),
  );

describe("deleteAccountIfOrphaned", () => {
  beforeEach(cleanup);
  afterAll(cleanup);

  test("active membership 0 件なら account を削除し session 消滅 + audit を残す (true)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("orphan");

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(true);
        expect(yield* db.readUser(userId)).toBeUndefined();
        expect((yield* db.readSessions(userId)).length).toBe(0); // user cascade で物理消滅
        expect(yield* countAccountDeleteAudit(userId)).toBe(1);
      }),
    ));

  test("active membership が残るなら削除しない (false)、account 維持", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("kept");
        const companyId = yield* db.seedCompany("kept");
        yield* db.seedMembership(userId, companyId, "OWNER");

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(false);
        expect(yield* db.readUser(userId)).toBeDefined();
        expect(yield* countAccountDeleteAudit(userId)).toBe(0);
      }),
    ));

  test("DELETED company の残存 membership だけなら orphan 扱いで削除 (true)", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("ghost");
        const companyId = yield* db.seedCompany("ghost");
        yield* db.seedMembership(userId, companyId, "OWNER");
        yield* db.markCompanyDeleted(companyId);

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(true);
        expect(yield* db.readUser(userId)).toBeUndefined();
      }),
    ));

  test("既に存在しない user への適用は二重削除せず安全 (true / no-op)", () =>
    run(
      Effect.gen(function* () {
        const userId = `${P}u-absent`;
        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));
        expect(deleted).toBe(true);
      }),
    ));

  // secondaryStorage 構成では session の実体は Redis のみ (Postgres session テーブルは常に空)。
  // DB 側の revoke だけでは削除済み user の session が生き残り、その cookie で事業所作成を叩くと
  // membership insert が FK 違反 500 になる実障害があった。orphan 削除は Redis 側も purge すること。
  test("orphan 削除は secondaryStorage (Redis) の session 実体と索引も purge する", () =>
    run(
      Effect.gen(function* () {
        const userId = yield* seedUser("redis");
        const tokens = [`${P}rtok-1`, `${P}rtok-2`];
        yield* seedRedisSessions(userId, tokens);

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(true);
        expect(yield* redisGet(`${P}rtok-1`)).toBeNull();
        expect(yield* redisGet(`${P}rtok-2`)).toBeNull();
        expect(yield* redisGet(`active-sessions-${userId}`)).toBeNull();
      }),
    ));

  test("membership が残り削除しない場合は Redis session に触れない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("rkept");
        const companyId = yield* db.seedCompany("rkept");
        yield* db.seedMembership(userId, companyId, "OWNER");
        yield* seedRedisSessions(userId, [`${P}rtok-kept`]);

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(false);
        expect(yield* redisGet(`${P}rtok-kept`)).not.toBeNull();
        expect(yield* redisGet(`active-sessions-${userId}`)).not.toBeNull();
      }),
    ));
});
