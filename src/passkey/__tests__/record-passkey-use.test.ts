import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { PasskeyRepo } from "../ports";

const { run, cleanup } = dbTest("record-passkey-use-");

afterAll(cleanup);

describe("パスキーを使った事実の記録", () => {
  test("保存した counter より小さい counter を記録しても counter は下がらず、最後に使った日時は更新される", async () => {
    const recorded = await run(
      Effect.gen(function* () {
        const owner = yield* TestDb.use((db) => db.seedUser(`owner-${crypto.randomUUID()}`));
        const repo = yield* PasskeyRepo;
        const id = crypto.randomUUID();
        yield* repo.insertPasskey({
          id,
          userId: owner.id,
          credentialId: crypto.randomUUID(),
          publicKey: new Uint8Array(8),
          counter: 5,
          aaguid: "00000000-0000-0000-0000-000000000000",
          transports: [],
        });
        yield* repo.recordPasskeyUse(id, 3);
        return yield* repo.listPasskeys(owner.id);
      }),
    );
    expect(recorded.map(({ counter }) => counter)).toEqual([5]);
    expect(recorded[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  test("保存した counter より大きい counter を記録すると counter が進み、無い行に記録すると当たった行が無いと返る", async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const owner = yield* TestDb.use((db) => db.seedUser(`owner-${crypto.randomUUID()}`));
        const repo = yield* PasskeyRepo;
        const id = crypto.randomUUID();
        yield* repo.insertPasskey({
          id,
          userId: owner.id,
          credentialId: crypto.randomUUID(),
          publicKey: new Uint8Array(8),
          counter: 5,
          aaguid: "00000000-0000-0000-0000-000000000000",
          transports: [],
        });
        const hit = yield* repo.recordPasskeyUse(id, 8);
        const missed = yield* repo.recordPasskeyUse(crypto.randomUUID(), 8);
        const rows = yield* repo.listPasskeys(owner.id);
        return { hit, missed, counters: rows.map(({ counter }) => counter) };
      }),
    );
    expect(outcome).toEqual({ hit: { id: expect.any(String) }, missed: undefined, counters: [8] });
  });
});
