import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { dbTest } from "../../__tests__/live-runner";
import { browserCookieHeaders, loginWithMagicLink } from "../../__tests__/session-helpers";
import { TestDb } from "../../__tests__/test-db";
import { ttlStoreWithoutCounting } from "../../__tests__/test-ttl-store";
import { signedOut } from "../../membership/__tests__/test-layers";
import { passkeyToSave } from "../../passkey/__tests__/helpers";
import { PasskeyRepo } from "../../passkey/ports";
import { checkSession } from "../../session-check";
import {
  buildAppWith,
  liveApp,
  listedPasskeyIds,
  type Outcome,
  outcomeOf,
  postJson,
  restoreKvStoreAfterEach,
  sameOriginHeaders,
  type SignedInSession,
  signedInSession,
  statusAndBody,
} from "./helpers";

const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };
const CALLBACK = "https://app.example.com/dashboard";

const deletionPath = (passkeyId: string) =>
  `/api/account/passkeys/${encodeURIComponent(passkeyId)}/delete`;

describe("パスキーの削除の API", () => {
  const { run, cleanup } = dbTest("passkey-delete-test-");
  restoreKvStoreAfterEach();
  afterEach(async () => {
    setSystemTime();
    await cleanup();
  });

  const createUser = (name: string) =>
    run(TestDb.use((db) => db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`)));

  const storePasskey = async (user: { readonly id: string }): Promise<string> => {
    const row = await run(
      PasskeyRepo.use((repo) =>
        repo.insertPasskey({ id: crypto.randomUUID(), userId: user.id, ...passkeyToSave() }),
      ),
    );
    if (typeof row === "string") throw new Error(`パスキーを保存できなかった: ${row}`);
    return row.id;
  };

  const missingPasskeyId = (): string => crypto.randomUUID();

  const sendDeletion = async (session: SignedInSession, passkeyId: string): Promise<Outcome> =>
    outcomeOf(
      await postJson(session.app, deletionPath(passkeyId), sameOriginHeaders(session.cookie), "{}"),
    );

  const deleteMissingTimes = async (session: SignedInSession, n: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++)
      statuses.push((await sendDeletion(session, missingPasskeyId())).status);
    return statuses;
  };

  const signIn = async (user: { readonly id: string; readonly email: string }) => {
    const login = await run(loginWithMagicLink({ email: user.email, callbackURL: CALLBACK }));
    const cookie = browserCookieHeaders(login.response).get("cookie");
    if (cookie === null) throw new Error("ログインの cookie が無い");
    return { user, app: liveApp(), cookie };
  };

  const isSessionActive = async (session: SignedInSession): Promise<boolean> =>
    (await run(checkSession(new Headers({ cookie: session.cookie }))))._tag === "Active";

  const postWithoutSession = async (path: string): Promise<Outcome> =>
    outcomeOf(await postJson(buildAppWith(signedOut()), path, sameOriginHeaders(""), "{}"));

  const postCrossSite = async (session: SignedInSession, path: string): Promise<number> =>
    (
      await session.app.request(path, {
        method: "POST",
        headers: { cookie: session.cookie, "sec-fetch-site": "cross-site" },
      })
    ).status;

  test("パスキーを 2 本持つ user が 1 本を削除すると成功し、一覧から削除した 1 本だけが消える", async () => {
    const owner = await createUser("owner");
    const removed = await storePasskey(owner);
    const kept = await storePasskey(owner);
    const session = signedInSession(owner);

    const outcome = await sendDeletion(session, removed);

    expect(outcome.status).toBe(200);
    expect(await listedPasskeyIds(session)).toEqual([kept]);
  });

  test("ほかの user のパスキーの id を送った応答は、存在しない id の応答と同じで、自分のパスキーの削除の成功とは異なり、ほかの user のパスキーは残る", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = await storePasskey(owner);
    const others = await storePasskey(other);
    const session = signedInSession(owner);

    const forOthers = await sendDeletion(session, others);
    const forMissing = await sendDeletion(session, missingPasskeyId());
    const forOwn = await sendDeletion(session, own);

    expect(statusAndBody(forOthers)).toEqual(statusAndBody(forMissing));
    expect(forOwn.status).toBe(200);
    expect(statusAndBody(forOthers)).not.toEqual(statusAndBody(forOwn));
    expect(await listedPasskeyIds(signedInSession(other))).toEqual([others]);
  });

  test("パスキーを 1 本だけ持つ user がそれを削除すると成功し、一覧が空になる", async () => {
    const owner = await createUser("owner");
    const only = await storePasskey(owner);
    const session = signedInSession(owner);

    const outcome = await sendDeletion(session, only);

    expect(outcome.status).toBe(200);
    expect(await listedPasskeyIds(session)).toEqual([]);
  });

  test("同じ user の 2 つの session の一方でパスキーを削除した後も、もう一方の session は有効なままである", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const acting = await signIn(owner);
    const another = await signIn(owner);
    expect(await isSessionActive(another)).toBe(true);

    const outcome = await sendDeletion(acting, passkey);

    expect(outcome.status).toBe(200);
    expect(await isSessionActive(another)).toBe(true);
  });

  test("同じ session で削除の要求を 10 回送るまでは試行枠の失敗にならず、11 回目は既存の API が試行枠を超えた時と同じ失敗になる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);

    const statuses = await deleteMissingTimes(session, ATTEMPTS_PER_MINUTE);
    const eleventh = await sendDeletion(session, missingPasskeyId());

    expect(statuses.filter((status) => status === RATE_LIMITED.status)).toEqual([]);
    expect(statusAndBody(eleventh)).toEqual(RATE_LIMITED);
  });

  test("同じ session で試行枠を超えた後も、同じ user の別の session からはパスキーを削除できる", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    await deleteMissingTimes(signedInSession(owner), ATTEMPTS_PER_MINUTE + 1);

    const outcome = await sendDeletion(signedInSession(owner), passkey);

    expect(outcome.status).toBe(200);
  });

  test("同じ session で試行枠を超えた後、1 分を過ぎると同じ session で再びパスキーを削除できる", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const session = signedInSession(owner);
    const start = Date.now();
    setSystemTime(start);
    await deleteMissingTimes(session, ATTEMPTS_PER_MINUTE + 1);
    expect((await sendDeletion(session, passkey)).status).toBe(RATE_LIMITED.status);

    setSystemTime(start + 61_000);

    expect((await sendDeletion(session, passkey)).status).toBe(200);
  });

  test("TTL store で回数を数えられない時も、パスキーを削除できる", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);

    const outcome = await sendDeletion(
      signedInSession(owner, { layer: ttlStoreWithoutCounting }),
      passkey,
    );

    expect(outcome.status).toBe(200);
  });

  test("session の無い要求で削除を送ると、既存のログイン済みの POST の API と同じ status と本文の失敗になり、パスキーは残る", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);

    const ours = await postWithoutSession(deletionPath(passkey));
    const existing = await postWithoutSession("/api/account/mfa/enroll");

    expect(statusAndBody(ours)).toEqual(statusAndBody(existing));
    expect(ours.status).not.toBe(200);
    expect(await listedPasskeyIds(signedInSession(owner))).toEqual([passkey]);
  });

  test("cross-site の要求で削除を送ると、既存のログイン済みの POST の API と同じ status の失敗になり、パスキーは残る", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const session = signedInSession(owner);

    const ours = await postCrossSite(session, deletionPath(passkey));
    const existing = await postCrossSite(session, "/api/account/mfa/enroll");

    expect(ours).toBe(existing);
    expect(ours).not.toBe(200);
    expect(await listedPasskeyIds(signedInSession(owner))).toEqual([passkey]);
  });

  test("user が自分のパスキーの削除を送っても、ほかの user のパスキーは一覧に残る", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = await storePasskey(owner);
    const others = [await storePasskey(other), await storePasskey(other)].toSorted();

    await sendDeletion(signedInSession(owner), own);

    expect((await listedPasskeyIds(signedInSession(other))).toSorted()).toEqual(others);
  });
});
