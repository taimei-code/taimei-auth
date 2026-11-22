import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { auditRowsFor, dbTest } from "../../__tests__/live-runner";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { browserCookieHeaders, loginWithMagicLink } from "../../__tests__/session-helpers";
import { TestDb } from "../../__tests__/test-db";
import { auditFailingLayer } from "../../__tests__/test-layers";
import { ttlStoreWithoutCounting } from "../../__tests__/test-ttl-store";
import { signedOut } from "../../membership/__tests__/test-layers";
import { passkeyToSave } from "../../passkey/__tests__/helpers";
import { PasskeyRepo } from "../../passkey/ports";
import { checkSession } from "../../session-check";
import {
  buildAppWith,
  CLIENT_IP,
  CLIENT_USER_AGENT,
  clientHeaders,
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
  const sentry = recordSentry();
  restoreKvStoreAfterEach();
  afterEach(async () => {
    setSystemTime();
    sentry.reset();
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

  const sendDeletion = async (
    session: SignedInSession,
    passkeyId: string,
    headers: Record<string, string> = {},
  ): Promise<Outcome> =>
    outcomeOf(
      await postJson(
        session.app,
        deletionPath(passkeyId),
        { ...sameOriginHeaders(session.cookie), ...headers },
        "{}",
      ),
    );

  const deletedAuditsOf = async (user: { readonly id: string }) =>
    (await run(auditRowsFor(user.id, "passkey_deleted"))).map((row) => row.payload);

  const failingAudit = auditFailingLayer(new Error("audit store unavailable"));

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

  test("要求の IP と userAgent を付けて自分のパスキーを削除すると、削除の記録が 1 件だけ増え、削除したパスキーの id、その aaguid、要求の IP と userAgent を持つ", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);

    const outcome = await sendDeletion(signedInSession(owner), passkey, clientHeaders);

    expect(outcome.status).toBe(200);
    expect(await deletedAuditsOf(owner)).toEqual([
      {
        passkey_id: passkey,
        aaguid: passkeyToSave().aaguid,
        ip: CLIENT_IP,
        userAgent: CLIENT_USER_AGENT,
      },
    ]);
  });

  test("存在しない id の削除を送った時は、削除の記録が増えない", async () => {
    const owner = await createUser("owner");
    await storePasskey(owner);

    const outcome = await sendDeletion(signedInSession(owner), missingPasskeyId());

    expect(outcome.status).not.toBe(200);
    expect(await deletedAuditsOf(owner)).toEqual([]);
  });

  test("ほかの user のパスキーの id の削除を送った時は、どちらの user にも削除の記録が増えない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const others = await storePasskey(other);

    const outcome = await sendDeletion(signedInSession(owner), others);

    expect(outcome.status).not.toBe(200);
    expect(await deletedAuditsOf(owner)).toEqual([]);
    expect(await deletedAuditsOf(other)).toEqual([]);
  });

  test("同じパスキーの id の削除を 2 回送ると、削除の記録は 1 件だけ増える", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const session = signedInSession(owner);

    await sendDeletion(session, passkey);
    await sendDeletion(session, passkey);

    expect(await deletedAuditsOf(owner)).toHaveLength(1);
  });

  test("audit の記帳が失敗する時も、削除の応答は成功で、パスキーは一覧から消える", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const session = signedInSession(owner, { layer: failingAudit });

    const outcome = await sendDeletion(session, passkey);

    expect(outcome.status).toBe(200);
    expect(await listedPasskeyIds(session)).toEqual([]);
  });

  test("audit の記帳が失敗した削除は、削除の event として Sentry に送られる", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);

    await sendDeletion(signedInSession(owner, { layer: failingAudit }), passkey);

    expect(sentry.auditFailureEvents()).toEqual(["passkey_deleted"]);
  });
});
