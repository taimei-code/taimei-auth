import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  createUser,
  forgetSessionCounts,
  openSession,
  readExistingSignedInApiCrossSite,
  readExistingSignedInApiWithoutSession,
  readPasskeys,
  readPasskeysCrossSite,
  readPasskeysWithoutSession,
  removeCreatedUsers,
  storePasskey,
} from "./harness/passkey-list-api";

const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };

const readTimes = async (n: number, read: () => Promise<{ status: number }>) => {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await read()).status);
  return statuses;
};

const encodings = (bytes: Uint8Array): string[] => {
  const buffer = Buffer.from(bytes);
  return [buffer.toString("base64url"), buffer.toString("base64"), buffer.toString("hex")];
};

describe("パスキーの一覧の API", () => {
  afterEach(async () => {
    setSystemTime();
    forgetSessionCounts();
    await removeCreatedUsers();
  });

  test("ログイン済みの user が一覧を読むと、保存したパスキーごとに削除に使う id と登録日時が返り、まだ使っていないパスキーの最後に使った日時は空になる", async () => {
    const owner = await createUser("owner");
    const first = await storePasskey(owner);
    const second = await storePasskey(owner);

    const outcome = await readPasskeys(await openSession(owner));

    expect(outcome.status).toBe(200);
    const byId = new Map(outcome.passkeys?.map((listed) => [listed.id, listed]));
    expect([...byId.keys()].toSorted()).toEqual([first.id, second.id].toSorted());
    for (const stored of [first, second]) {
      expect(byId.get(stored.id)?.registeredAt.getTime()).toBe(stored.registeredAt.getTime());
      expect(byId.get(stored.id)?.lastUsedAt).toBeNull();
    }
  });

  test("一覧には、ほかの user が保存したパスキーが出ない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = await storePasskey(owner);
    await storePasskey(other);

    const outcome = await readPasskeys(await openSession(owner));

    expect(outcome.passkeys?.map(({ id }) => id)).toEqual([own.id]);
  });

  test("パスキーが無い user が一覧を読むと、成功して空の一覧が返る", async () => {
    const owner = await createUser("owner");

    const outcome = await readPasskeys(await openSession(owner));

    expect(outcome.status).toBe(200);
    expect(outcome.passkeys).toEqual([]);
  });

  test("session の無い要求は、既存のログイン済みの API と同じ status と本文の失敗になる", async () => {
    const ours = await readPasskeysWithoutSession();
    const existing = await readExistingSignedInApiWithoutSession();

    expect(ours).toEqual(existing);
  });

  test("一覧の応答の本文に、保存したパスキーの公開鍵と credential の id がどの符号化でも含まれない", async () => {
    const owner = await createUser("owner");
    const stored = await storePasskey(owner);

    const outcome = await readPasskeys(await openSession(owner));

    expect(outcome.status).toBe(200);
    const secrets = [
      stored.credentialId,
      ...encodings(new Uint8Array(Buffer.from(stored.credentialId, "base64url"))),
      ...encodings(stored.publicKey),
      [...stored.publicKey].join(","),
    ];
    expect(secrets.filter((secret) => outcome.bodyText.includes(secret))).toEqual([]);
  });

  test("同じ session で 10 回目までは読め、11 回目は既存の API が試行枠を超えた時と同じ失敗になる", async () => {
    const owner = await createUser("owner");
    const session = await openSession(owner);

    const statuses = await readTimes(ATTEMPTS_PER_MINUTE, () => readPasskeys(session));
    const eleventh = await readPasskeys(session);

    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    expect({ status: eleventh.status, body: JSON.parse(eleventh.bodyText) }).toEqual(RATE_LIMITED);
  });

  test("同じ session で試行枠を超えた後も、同じ user の別の session からは一覧を読める", async () => {
    const owner = await createUser("owner");
    const session = await openSession(owner);
    await readTimes(ATTEMPTS_PER_MINUTE + 1, () => readPasskeys(session));

    const outcome = await readPasskeys(await openSession(owner));

    expect(outcome.status).toBe(200);
  });

  test("同じ session で試行枠を超えた後、1 分を過ぎると同じ session で再び一覧を読める", async () => {
    const owner = await createUser("owner");
    const session = await openSession(owner);
    const start = Date.now();
    setSystemTime(start);
    await readTimes(ATTEMPTS_PER_MINUTE + 1, () => readPasskeys(session));
    expect((await readPasskeys(session)).status).toBe(RATE_LIMITED.status);

    setSystemTime(start + 61_000);

    expect((await readPasskeys(session)).status).toBe(200);
  });

  test("TTL store で回数を数えられない時も、一覧を読める", async () => {
    const owner = await createUser("owner");

    const outcome = await readPasskeys(await openSession(owner, { ttlStoreUncountable: true }));

    expect(outcome.status).toBe(200);
  });

  test("cross-site の form の要求で一覧を読むと、既存のログイン済みの GET と同じく CSRF の検査で止まらずに成功する", async () => {
    const owner = await createUser("owner");
    const session = await openSession(owner);

    const ours = await readPasskeysCrossSite(session);
    const existing = await readExistingSignedInApiCrossSite(session);

    expect(ours).toBe(200);
    expect(ours).toBe(existing);
  });
});
