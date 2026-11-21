import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { PasskeyRepo } from "../ports";
import { passkeysOf, savePasskey, signedRegistration } from "./helpers";

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

  const savedCredential = (userId: string, counter: number) => {
    const { made } = signedRegistration({
      algorithm: "ES256",
      challenge: "Y2hhbGxlbmdlLWZyb20tdGhlLWxvZ2luLW9wdGlvbnM",
      userVerified: true,
    });
    return savePasskey(userId, {
      credentialId: made.id,
      publicKey: made.publicKey,
      counter,
      aaguid: made.aaguid,
      transports: made.transports,
    }).pipe(Effect.as(made));
  };

  const recordUse = (credentialId: string, counter: number) =>
    PasskeyRepo.use((repo) =>
      repo
        .findPasskeyByCredentialId(credentialId)
        .pipe(Effect.flatMap((row) => repo.recordPasskeyUse(row?.id ?? "", counter))),
    );

  test("保存した credential の id で引くと、保存した user、credential の id、公開鍵、counter を持つ行が得られ、保存していない id では何も得られない", async () => {
    const found = await run(
      Effect.gen(function* () {
        const owner = yield* TestDb.use((db) => db.seedUser(`owner-${crypto.randomUUID()}`));
        const made = yield* savedCredential(owner.id, 4);
        const unsaved = signedRegistration({
          algorithm: "ES256",
          challenge: "Y2hhbGxlbmdlLWZyb20tdGhlLWxvZ2luLW9wdGlvbnM",
          userVerified: true,
        }).made;
        const repo = yield* PasskeyRepo;
        return {
          owner: owner.id,
          made,
          row: yield* repo.findPasskeyByCredentialId(made.id),
          missing: yield* repo.findPasskeyByCredentialId(unsaved.id),
        };
      }),
    );

    expect(found.row).toMatchObject({
      userId: found.owner,
      credentialId: found.made.id,
      counter: 4,
    });
    expect([...(found.row?.publicKey ?? [])]).toEqual([...found.made.publicKey]);
    expect(found.missing).toBeUndefined();
  });

  test("使った事実を記録すると、そのパスキーの counter と最後に使った日時だけが変わり、同じ user の別のパスキーとほかの user のパスキーは変わらない", async () => {
    const observed = await run(
      Effect.gen(function* () {
        const owner = yield* TestDb.use((db) => db.seedUser(`owner-${crypto.randomUUID()}`));
        const other = yield* TestDb.use((db) => db.seedUser(`other-${crypto.randomUUID()}`));
        const used = yield* savedCredential(owner.id, 2);
        yield* savedCredential(owner.id, 2);
        yield* savedCredential(other.id, 2);
        const ownerBefore = yield* passkeysOf(owner.id);
        const otherBefore = yield* passkeysOf(other.id);

        const before = Date.now();
        yield* recordUse(used.id, 9);
        const after = Date.now();

        return {
          usedId: used.id,
          ownerBefore,
          ownerAfter: yield* passkeysOf(owner.id),
          otherBefore,
          otherAfter: yield* passkeysOf(other.id),
          between: { before, after },
        };
      }),
    );

    expect(observed.ownerAfter).toEqual(
      observed.ownerBefore.map((row) =>
        row.credentialId === observed.usedId
          ? { ...row, counter: 9, lastUsedAt: expect.any(Date) }
          : row,
      ),
    );
    const usedAfter = observed.ownerAfter.find(
      ({ credentialId }) => credentialId === observed.usedId,
    );
    expect(usedAfter?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(observed.between.before);
    expect(usedAfter?.lastUsedAt?.getTime()).toBeLessThanOrEqual(observed.between.after);
    expect(observed.otherAfter).toEqual(observed.otherBefore);
  });

  test("counter が 0 のパスキーに counter 0 で使った事実を記録しても、最後に使った日時が更新される", async () => {
    const observed = await run(
      Effect.gen(function* () {
        const owner = yield* TestDb.use((db) => db.seedUser(`owner-${crypto.randomUUID()}`));
        const made = yield* savedCredential(owner.id, 0);
        const before = Date.now();
        yield* recordUse(made.id, 0);
        const after = Date.now();
        return { rows: yield* passkeysOf(owner.id), before, after };
      }),
    );

    const [row] = observed.rows;
    expect(row?.counter).toBe(0);
    expect(row?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(observed.before);
    expect(row?.lastUsedAt?.getTime()).toBeLessThanOrEqual(observed.after);
  });
});
