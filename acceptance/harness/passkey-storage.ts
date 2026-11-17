import { randomBytes } from "node:crypto";
import { Effect } from "effect";
import { deleteUser } from "../../db/repositories/user";
import { TestDb, testDbLayer } from "../../src/__tests__/test-db";

const withTestDb = <A, E>(use: (testDb: TestDb["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    TestDb.pipe(Effect.flatMap(use), Effect.provide(testDbLayer("acceptance-passkey-storage-"))),
  );

export type PasskeyToSave = {
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly counter: number;
  readonly aaguid: string;
  readonly transports: Array<"internal" | "hybrid" | "usb">;
};

export type SavedPasskey = PasskeyToSave & {
  readonly registeredAt: Date;
  readonly lastUsedAt: Date | null;
};

export const passkeyToSave = (): PasskeyToSave => ({
  credentialId: randomBytes(16).toString("base64url"),
  publicKey: new Uint8Array(randomBytes(77)),
  counter: 7,
  aaguid: "adce0002-35bc-c60a-648b-0b25f1f05503",
  transports: ["internal", "hybrid"],
});

export const createUser = async (name: string): Promise<string> =>
  (await withTestDb((testDb) => testDb.seedUser(`${name}-${crypto.randomUUID()}`))).id;

export const removeUser = async (userId: string): Promise<void> => {
  await deleteUser(userId);
};

export const removeCreatedUsers = (): Promise<void> => withTestDb((testDb) => testDb.cleanup());

export const savePasskey = async (userId: string, passkey: PasskeyToSave): Promise<boolean> => {
  const { generatePasskeyId, insertPasskey } = await import("../../db/repositories/passkey");
  const saved = await insertPasskey({ id: generatePasskeyId(), userId, ...passkey });
  return saved !== undefined;
};

export const passkeysOf = async (userId: string): Promise<SavedPasskey[]> => {
  const { listPasskeys } = await import("../../db/repositories/passkey");
  const rows = await listPasskeys(userId);
  return rows.map((row) => ({
    credentialId: row.credentialId,
    publicKey: new Uint8Array(row.publicKey),
    counter: row.counter,
    aaguid: row.aaguid,
    transports: [...row.transports] as PasskeyToSave["transports"],
    registeredAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
};
