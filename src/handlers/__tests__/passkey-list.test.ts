import { afterEach, describe, expect, setSystemTime, spyOn, test } from "bun:test";
import { dbTest, partial } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { ttlStoreWithoutCounting } from "../../__tests__/test-ttl-store";
import { Effect, Layer } from "effect";
import { CLIENT_IP_HEADER } from "../../client-ip";
import { signedIn, signedOut } from "../../membership/__tests__/test-layers";
import { passkeyToSave } from "../../passkey/__tests__/helpers";
import { PasskeyRepo } from "../../passkey/ports";
import { JSON_HEADERS } from "../client-facing-error";
import {
  buildAppWith,
  freshSessionCookie,
  postJson,
  restoreKvStoreAfterEach,
  sameOriginHeaders,
  type SignedInSession,
  signedInSession,
} from "./helpers";

const USED = {
  id: "pk-used",
  userId: "u1",
  credentialId: "Y3JlZGVudGlhbA",
  publicKey: new Uint8Array([1, 2, 3]),
  counter: 0,
  aaguid: "00000000-0000-0000-0000-000000000000",
  transports: [],
  createdAt: new Date("2026-11-01T00:00:00.000Z"),
  lastUsedAt: new Date("2026-11-02T03:04:05.678Z") as Date | null,
};
const UNUSED = { ...USED, id: "pk-unused", lastUsedAt: null };
const GOOGLE_PM_AAGUID = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4";

const passkeyRepoWith = (rows: (typeof USED)[]) =>
  Layer.succeed(
    PasskeyRepo,
    partial<PasskeyRepo["Service"]>({ listPasskeys: () => Effect.succeed(rows) }),
  );

describe("パスキーの一覧の API の応答", () => {
  test("使ったパスキーは最後に使った日時を ISO 8601 の文字列で、未使用のパスキーは null で返す", async () => {
    const app = buildAppWith(Layer.mergeAll(signedIn(), passkeyRepoWith([USED, UNUSED])));

    const res = await app.request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, ...freshSessionCookie() },
    });

    expect(await res.json<unknown>()).toEqual({
      passkeys: [
        {
          id: "pk-used",
          created_at: "2026-11-01T00:00:00.000Z",
          last_used_at: "2026-11-02T03:04:05.678Z",
          provider_name: null,
        },
        {
          id: "pk-unused",
          created_at: "2026-11-01T00:00:00.000Z",
          last_used_at: null,
          provider_name: null,
        },
      ],
      can_register: true,
    });
  });

  test("Google パスワードマネージャーが公開した aaguid のパスキーは、一覧の項目に提供元の名前が含まれる", async () => {
    const app = buildAppWith(
      Layer.mergeAll(signedIn(), passkeyRepoWith([{ ...USED, aaguid: GOOGLE_PM_AAGUID }])),
    );

    const res = await app.request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, ...freshSessionCookie() },
    });

    const body = await res.json<{ passkeys: Array<Record<string, unknown>> }>();
    expect(body.passkeys.map((item) => Object.values(item))).toEqual([
      expect.arrayContaining(["Google パスワードマネージャー"]),
    ]);
  });

  test("aaguid が全 0 のパスキーは、どの提供元とも言えないので名前を返さない", async () => {
    const app = buildAppWith(
      Layer.mergeAll(
        signedIn(),
        passkeyRepoWith([{ ...USED, aaguid: "00000000-0000-0000-0000-000000000000" }]),
      ),
    );

    const res = await app.request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, ...freshSessionCookie() },
    });

    const body = await res.json<{ passkeys: Array<{ provider_name: unknown }> }>();
    expect(body.passkeys.map(({ provider_name }) => provider_name)).toEqual([null]);
  });

  test("提供元を引く時に外部へ通信せず、fetch が失敗する状態でも名前が返る", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("外部への通信"));
    try {
      const app = buildAppWith(
        Layer.mergeAll(signedIn(), passkeyRepoWith([{ ...USED, aaguid: GOOGLE_PM_AAGUID }])),
      );

      const res = await app.request("/api/account/passkeys", {
        headers: { ...JSON_HEADERS, ...freshSessionCookie() },
      });

      const body = await res.json<{ passkeys: Array<Record<string, unknown>> }>();
      expect(body.passkeys.flatMap((item) => Object.values(item))).toContain(
        "Google パスワードマネージャー",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test("一覧の日時は、保存した日時の ISO 8601 の文字列と、未使用の時の null のまま返る", async () => {
    const app = buildAppWith(Layer.mergeAll(signedIn(), passkeyRepoWith([USED, UNUSED])));

    const res = await app.request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, ...freshSessionCookie() },
    });

    const body = await res.json<{
      passkeys: Array<{ created_at: unknown; last_used_at: unknown }>;
    }>();
    expect(
      body.passkeys.map(({ created_at, last_used_at }) => ({ created_at, last_used_at })),
    ).toEqual([
      { created_at: "2026-11-01T00:00:00.000Z", last_used_at: "2026-11-02T03:04:05.678Z" },
      { created_at: "2026-11-01T00:00:00.000Z", last_used_at: null },
    ]);
  });

  test("未ログインの要求は試行枠を数える前に 401 になり、同じ IP から 11 回送っても 429 にならない", async () => {
    const app = buildAppWith(signedOut());
    const ip = `2001:db8::${crypto.randomUUID().slice(0, 4)}`;

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.request("/api/account/passkeys", {
        headers: { ...JSON_HEADERS, [CLIENT_IP_HEADER]: ip },
      });
      statuses.push(res.status);
    }

    expect(new Set(statuses)).toEqual(new Set([401]));
  });
});

const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };

describe("パスキーの一覧の API の応答を、保存したパスキーと session ごとの試行枠から確かめる", () => {
  const { run, cleanup } = dbTest("passkey-list-test-");
  restoreKvStoreAfterEach();
  afterEach(async () => {
    setSystemTime();
    await cleanup();
  });

  const createUser = (name: string) =>
    run(TestDb.use((db) => db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`)));

  const storePasskey = async (userId: string) => {
    const material = passkeyToSave();
    const row = await run(
      PasskeyRepo.use((repo) =>
        repo.insertPasskey({ id: crypto.randomUUID(), userId, ...material }),
      ),
    );
    if (typeof row === "string") throw new Error(`パスキーを保存できなかった: ${row}`);
    return {
      id: row.id,
      credentialId: row.credentialId,
      publicKey: material.publicKey,
      registeredAt: row.createdAt,
    };
  };

  const read = async (session: SignedInSession) => {
    const response = await session.app.request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, cookie: session.cookie },
    });
    const bodyText = await response.text();
    const passkeys =
      response.status === 200
        ? (
            JSON.parse(bodyText) as {
              passkeys: Array<{ id: string; created_at: string; last_used_at: string | null }>;
            }
          ).passkeys.map((item) => ({
            id: item.id,
            registeredAt: new Date(item.created_at),
            lastUsedAt: item.last_used_at === null ? null : new Date(item.last_used_at),
          }))
        : null;
    return { status: response.status, bodyText, passkeys };
  };

  const readTimes = async (n: number, session: SignedInSession) => {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) statuses.push((await read(session)).status);
    return statuses;
  };

  const encodings = (bytes: Uint8Array): string[] => {
    const buffer = Buffer.from(bytes);
    return [buffer.toString("base64url"), buffer.toString("base64"), buffer.toString("hex")];
  };

  const crossSiteHeaders = (session: SignedInSession) => ({
    cookie: session.cookie,
    "sec-fetch-site": "cross-site",
    "content-type": "application/x-www-form-urlencoded",
  });

  test("ログイン済みの user が一覧を読むと、保存したパスキーごとに削除に使う id と登録日時が返り、まだ使っていないパスキーの最後に使った日時は空になる", async () => {
    const owner = await createUser("owner");
    const first = await storePasskey(owner.id);
    const second = await storePasskey(owner.id);

    const outcome = await read(signedInSession(owner));

    expect(outcome.status).toBe(200);
    const byId = new Map(outcome.passkeys?.map((listed) => [listed.id, listed]));
    expect([...byId.keys()].toSorted()).toEqual([first.id, second.id].toSorted());
    for (const stored of [first, second]) {
      expect(byId.get(stored.id)?.registeredAt.getTime()).toBe(stored.registeredAt.getTime());
      expect(byId.get(stored.id)?.lastUsedAt).toBeNull();
    }
  });

  test("名前を渡さずに保存した Google パスワードマネージャーの aaguid のパスキーを読むと、提供元の名前が返る", async () => {
    const owner = await createUser("owner");
    const saved = await run(
      PasskeyRepo.use((repo) =>
        repo.insertPasskey({
          id: crypto.randomUUID(),
          userId: owner.id,
          ...passkeyToSave(),
          aaguid: GOOGLE_PM_AAGUID,
        }),
      ),
    );
    if (typeof saved === "string") throw new Error(`パスキーを保存できなかった: ${saved}`);

    const outcome = await read(signedInSession(owner));

    expect(outcome.status).toBe(200);
    const listed = (JSON.parse(outcome.bodyText) as { passkeys: Array<Record<string, unknown>> })
      .passkeys;
    expect(listed.flatMap((item) => Object.values(item))).toContain(
      "Google パスワードマネージャー",
    );
  });

  test("一覧には、ほかの user が保存したパスキーが出ない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = await storePasskey(owner.id);
    await storePasskey(other.id);

    const outcome = await read(signedInSession(owner));

    expect(outcome.passkeys?.map(({ id }) => id)).toEqual([own.id]);
  });

  test("パスキーが無い user が一覧を読むと、成功して空の一覧が返る", async () => {
    const owner = await createUser("owner");

    const outcome = await read(signedInSession(owner));

    expect(outcome.status).toBe(200);
    expect(outcome.passkeys).toEqual([]);
  });

  test("一覧の応答の本文に、保存したパスキーの公開鍵と credential の id がどの符号化でも含まれない", async () => {
    const owner = await createUser("owner");
    const stored = await storePasskey(owner.id);

    const outcome = await read(signedInSession(owner));

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
    const session = signedInSession(owner);

    const statuses = await readTimes(ATTEMPTS_PER_MINUTE, session);
    const eleventh = await read(session);

    expect(statuses.filter((status) => status !== 200)).toEqual([]);
    expect({ status: eleventh.status, body: JSON.parse(eleventh.bodyText) }).toEqual(RATE_LIMITED);
  });

  test("同じ session で試行枠を超えた後も、同じ user の別の session からは一覧を読める", async () => {
    const owner = await createUser("owner");
    await readTimes(ATTEMPTS_PER_MINUTE + 1, signedInSession(owner));

    const outcome = await read(signedInSession(owner));

    expect(outcome.status).toBe(200);
  });

  test("同じ session で試行枠を超えた後、1 分を過ぎると同じ session で再び一覧を読める", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const start = Date.now();
    setSystemTime(start);
    await readTimes(ATTEMPTS_PER_MINUTE + 1, session);
    expect((await read(session)).status).toBe(RATE_LIMITED.status);

    setSystemTime(start + 61_000);

    expect((await read(session)).status).toBe(200);
  });

  test("TTL store で回数を数えられない時も、一覧を読める", async () => {
    const owner = await createUser("owner");

    const outcome = await read(signedInSession(owner, { layer: ttlStoreWithoutCounting }));

    expect(outcome.status).toBe(200);
  });

  test("cross-site の form の要求で一覧を読むと、既存のログイン済みの GET と同じく CSRF の検査で止まらずに成功する", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);

    const ours = (
      await session.app.request("/api/account/passkeys", { headers: crossSiteHeaders(session) })
    ).status;
    const existing = (
      await session.app.request("/api/account/mfa", { headers: crossSiteHeaders(session) })
    ).status;

    expect(ours).toBe(200);
    expect(ours).toBe(existing);
  });

  test("同じ session で一覧を 10 回読んだ後も、MFA の有効化の開始は試行枠の失敗にならない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    await readTimes(ATTEMPTS_PER_MINUTE, session);

    const enrollment = await postJson(
      session.app,
      "/api/account/mfa/enroll",
      sameOriginHeaders(session.cookie),
      "{}",
    );

    expect(enrollment.status).not.toBe(429);
    expect(enrollment.status).toBeLessThan(500);
  });
});
