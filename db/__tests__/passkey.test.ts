import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { generatePasskeyId, insertPasskey, listPasskeys } from "../repositories/passkey";
import { deleteUser } from "../repositories/user";
import { createSeed } from "../testing/seed";
import { type PasskeyToSave, passkeyToSave } from "../../src/passkey/__tests__/helpers";

const seed = createSeed("passkey-table-test-");

const createUser = async (name: string): Promise<string> =>
  (await seed.seedUser(`${name}-${crypto.randomUUID()}`)).id;

const savingOf = (userId: string, passkey: PasskeyToSave) =>
  insertPasskey({ id: generatePasskeyId(), userId, ...passkey });

const savePasskey = async (userId: string, passkey: PasskeyToSave): Promise<boolean> =>
  typeof (await savingOf(userId, passkey)) !== "string";

const credentialIdsOf = async (userId: string): Promise<string[]> =>
  (await listPasskeys(userId)).map(({ credentialId }) => credentialId);

describe("パスキーの保存と一覧", () => {
  beforeEach(seed.cleanup);
  afterAll(seed.cleanup);

  test("保存したパスキーが、その user の一覧に、保存した値と登録日時を持ち、最後に使った日時の無いパスキーとして 1 つ出る", async () => {
    const owner = await createUser("owner");
    const passkey = passkeyToSave();

    expect(await savePasskey(owner, passkey)).toBe(true);

    const listed = await listPasskeys(owner);
    expect(listed).toHaveLength(1);
    const [only] = listed;
    expect(only?.credentialId).toBe(passkey.credentialId);
    expect([...(only?.publicKey ?? [])]).toEqual([...passkey.publicKey]);
    expect(only?.counter).toBe(passkey.counter);
    expect(only?.aaguid).toBe(passkey.aaguid);
    expect(only?.transports).toEqual(passkey.transports);
    expect(only?.createdAt).toBeInstanceOf(Date);
    expect(only?.lastUsedAt).toBeNull();
  });

  test("user の一覧には、ほかの user が保存したパスキーが出ない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = passkeyToSave();
    await savePasskey(owner, own);
    await savePasskey(other, passkeyToSave());

    expect(await credentialIdsOf(owner)).toEqual([own.credentialId]);
  });

  test("同じ credential の id のパスキーを同時に 2 回保存すると、片方だけが保存されたと返り、一覧には 1 つだけ出る", async () => {
    const owner = await createUser("owner");
    const passkey = passkeyToSave();

    const results = await Promise.all([savePasskey(owner, passkey), savePasskey(owner, passkey)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await credentialIdsOf(owner)).toEqual([passkey.credentialId]);
  });

  test("ほかの user が保存済みの credential の id を保存すると、保存されなかったと返り、一覧に出ない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const passkey = passkeyToSave();
    await savePasskey(owner, passkey);

    expect(await savePasskey(other, passkey)).toBe(false);
    expect(await listPasskeys(other)).toEqual([]);
  });

  test("user を消すと、その user の一覧からパスキーが消え、同じ credential の id を別の user で保存できる", async () => {
    const owner = await createUser("owner");
    const next = await createUser("next");
    const passkey = passkeyToSave();
    await savePasskey(owner, passkey);

    await deleteUser(owner);

    expect(await listPasskeys(owner)).toEqual([]);
    expect(await savePasskey(next, passkey)).toBe(true);
  });

  const saveMany = async (userId: string, count: number) => {
    for (let i = 0; i < count; i++) await savePasskey(userId, passkeyToSave());
  };

  test("10 本ある user の 11 本目は上限で拒まれ、一覧は 10 本のまま増えない", async () => {
    const owner = await createUser("owner");
    await saveMany(owner, 10);

    expect(await savingOf(owner, passkeyToSave())).toBe("LimitReached");
    expect(await listPasskeys(owner)).toHaveLength(10);
  });

  test("9 本ある user の 10 本目は保存でき、ほかの user が 10 本持っていても数えない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    await saveMany(other, 10);
    await saveMany(owner, 9);

    expect(await savePasskey(owner, passkeyToSave())).toBe(true);
    expect(await listPasskeys(owner)).toHaveLength(10);
  });

  test("保存済みの credential の id は、上限に達していてもいなくても「登録済み」で拒まれる", async () => {
    const roomy = await createUser("roomy");
    const full = await createUser("full");
    const roomyPasskey = passkeyToSave();
    const fullPasskey = passkeyToSave();
    await savePasskey(roomy, roomyPasskey);
    await savePasskey(full, fullPasskey);
    await saveMany(full, 9);

    expect(await savingOf(roomy, roomyPasskey)).toBe("CredentialTaken");
    expect(await savingOf(full, fullPasskey)).toBe("CredentialTaken");
    expect(await listPasskeys(full)).toHaveLength(10);
  });
});
