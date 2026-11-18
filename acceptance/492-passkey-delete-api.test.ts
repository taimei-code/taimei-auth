import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  createUser,
  existingSignedInPostCrossSite,
  existingSignedInPostWithoutSession,
  forgetScenario,
  isSessionActive,
  missingPasskeyId,
  openSession,
  readListedIds,
  sendDeletion,
  sendDeletionCrossSite,
  sendDeletionWithoutSession,
  type Session,
  signIn,
  storePasskey,
} from "./harness/passkey-delete-api";

const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };

const deleteMissingTimes = async (session: Session, n: number) => {
  const statuses: number[] = [];
  for (let i = 0; i < n; i++) statuses.push((await sendDeletion(session, missingPasskeyId())).status);
  return statuses;
};

describe("パスキーの削除の API", () => {
  afterEach(async () => {
    setSystemTime();
    await forgetScenario();
  });

  test("パスキーを 2 本持つ user が 1 本を削除すると成功し、一覧から削除した 1 本だけが消える", async () => {
    const owner = await createUser("owner");
    const removed = await storePasskey(owner);
    const kept = await storePasskey(owner);
    const session = openSession(owner);

    const outcome = await sendDeletion(session, removed);

    expect(outcome.status).toBe(200);
    expect(await readListedIds(session)).toEqual([kept]);
  });

  test("ほかの user のパスキーの id を送った応答は、存在しない id の応答と同じで、自分のパスキーの削除の成功とは異なり、ほかの user のパスキーは残る", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = await storePasskey(owner);
    const others = await storePasskey(other);
    const session = openSession(owner);

    const forOthers = await sendDeletion(session, others);
    const forMissing = await sendDeletion(session, missingPasskeyId());
    const forOwn = await sendDeletion(session, own);

    expect(forOthers).toEqual(forMissing);
    expect(forOwn.status).toBe(200);
    expect(forOthers).not.toEqual(forOwn);
    expect(await readListedIds(openSession(other))).toEqual([others]);
  });

  test("パスキーを 1 本だけ持つ user がそれを削除すると成功し、一覧が空になる", async () => {
    const owner = await createUser("owner");
    const only = await storePasskey(owner);
    const session = openSession(owner);

    const outcome = await sendDeletion(session, only);

    expect(outcome.status).toBe(200);
    expect(await readListedIds(session)).toEqual([]);
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
    const session = openSession(owner);

    const statuses = await deleteMissingTimes(session, ATTEMPTS_PER_MINUTE);
    const eleventh = await sendDeletion(session, missingPasskeyId());

    expect(statuses.filter((status) => status === RATE_LIMITED.status)).toEqual([]);
    expect({ status: eleventh.status, body: JSON.parse(eleventh.body) }).toEqual(RATE_LIMITED);
  });

  test("同じ session で試行枠を超えた後も、同じ user の別の session からはパスキーを削除できる", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    await deleteMissingTimes(openSession(owner), ATTEMPTS_PER_MINUTE + 1);

    const outcome = await sendDeletion(openSession(owner), passkey);

    expect(outcome.status).toBe(200);
  });

  test("同じ session で試行枠を超えた後、1 分を過ぎると同じ session で再びパスキーを削除できる", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const session = openSession(owner);
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

    const outcome = await sendDeletion(openSession(owner, { trouble: "uncountable" }), passkey);

    expect(outcome.status).toBe(200);
  });

  test("session の無い要求で削除を送ると、既存のログイン済みの POST の API と同じ status と本文の失敗になり、パスキーは残る", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);

    const ours = await sendDeletionWithoutSession(passkey);
    const existing = await existingSignedInPostWithoutSession();

    expect(ours).toEqual(existing);
    expect(ours.status).not.toBe(200);
    expect(await readListedIds(openSession(owner))).toEqual([passkey]);
  });

  test("cross-site の要求で削除を送ると、既存のログイン済みの POST の API と同じ status の失敗になり、パスキーは残る", async () => {
    const owner = await createUser("owner");
    const passkey = await storePasskey(owner);
    const session = openSession(owner);

    const ours = await sendDeletionCrossSite(session, passkey);
    const existing = await existingSignedInPostCrossSite(session);

    expect(ours).toBe(existing);
    expect(ours).not.toBe(200);
    expect(await readListedIds(openSession(owner))).toEqual([passkey]);
  });
});
