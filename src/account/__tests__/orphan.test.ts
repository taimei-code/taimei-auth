import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getMemoryKvStore } from "../../ttl-store";
import { runTest, inTx } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { deleteAccountIfOrphaned } from "../orphan";

const P = "orphan-test-";
const run = runTest(P);

const cleanup = () =>
  run(
    Effect.gen(function* () {
      yield* (yield* TestDb).cleanup();
      const s = getMemoryKvStore();
      for (const key of [
        `${P}rtok-1`,
        `${P}rtok-2`,
        `active-sessions-${P}u-store`,
        `${P}rtok-kept`,
        `active-sessions-${P}u-rkept`,
      ]) {
        s.delete(key);
      }
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
const seedSessions = (userId: string, tokens: string[]) =>
  Effect.sync(() => {
    const s = getMemoryKvStore();
    const expiresAt = Date.now() + 86_400_000;
    for (const token of tokens) {
      s.set(token, JSON.stringify({ session: { token, userId, expiresAt }, user: {} }));
    }
    s.set(
      `active-sessions-${userId}`,
      JSON.stringify(tokens.map((token) => ({ token, expiresAt }))),
    );
  });

const storeGet = (key: string) => Effect.sync(() => getMemoryKvStore().get(key));

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

  // secondaryStorage 構成では session の実体は TTL store のみ (Postgres session テーブルは常に空)。
  // DB 側の revoke だけでは削除済み user の session が生き残り、その cookie で事業所作成を叩くと
  // membership insert が FK 違反 500 になる実障害があった。orphan 削除は TTL store 側も purge すること。
  test("orphan 削除は secondaryStorage (TTL store) の session 実体と索引も purge する", () =>
    run(
      Effect.gen(function* () {
        const userId = yield* seedUser("store");
        const tokens = [`${P}rtok-1`, `${P}rtok-2`];
        yield* seedSessions(userId, tokens);

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(true);
        expect(yield* storeGet(`${P}rtok-1`)).toBeNull();
        expect(yield* storeGet(`${P}rtok-2`)).toBeNull();
        expect(yield* storeGet(`active-sessions-${userId}`)).toBeNull();
      }),
    ));

  test("membership が残り削除しない場合は TTL store の session に触れない", () =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const userId = yield* seedUser("rkept");
        const companyId = yield* db.seedCompany("rkept");
        yield* db.seedMembership(userId, companyId, "OWNER");
        yield* seedSessions(userId, [`${P}rtok-kept`]);

        const deleted = yield* inTx((tx) => deleteAccountIfOrphaned(userId, tx));

        expect(deleted).toBe(false);
        expect(yield* storeGet(`${P}rtok-kept`)).not.toBeNull();
        expect(yield* storeGet(`active-sessions-${userId}`)).not.toBeNull();
      }),
    ));
});
