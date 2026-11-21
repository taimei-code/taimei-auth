import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { generatePasskeyId, insertPasskey, listPasskeys } from "../repositories/passkey";
import { deleteUser } from "../repositories/user";
import { createSeed } from "../testing/seed";
import { type PasskeyToSave, passkeyToSave } from "../../src/passkey/__tests__/helpers";

const seed = createSeed("passkey-table-test-");

const createUser = async (name: string): Promise<string> =>
  (await seed.seedUser(`${name}-${crypto.randomUUID()}`)).id;

const savePasskey = async (userId: string, passkey: PasskeyToSave): Promise<boolean> =>
  (await insertPasskey({ id: generatePasskeyId(), userId, ...passkey })) !== undefined;

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
});
