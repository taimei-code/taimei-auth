import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  createMfaEnabledUser,
  createUser,
  crossSiteStatuses,
  forgetScenario,
  openSession,
  optionsOf,
  type Outcome,
  postExistingSignedInApiWithoutSession,
  readListedIds,
  requestOptions,
  requestOptionsWithoutSession,
  sameSessionWithTrouble,
  saveCredential,
  savedCredentialIdsOf,
  saveSomeCredential,
  sendRegistration,
  sendRegistrationWithoutSession,
  signedResponse,
  ttlValuesHolding,
  withChallengeReplacedBy,
} from "./harness/passkey-registration-api";

const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const ONE_SECOND_MS = 1000;
const OTHER_ORIGIN = "https://evil.example.net";

const expectKnownClientFailure = (outcome: Outcome) => {
  expect(outcome.status).toBeGreaterThanOrEqual(400);
  expect(outcome.status).toBeLessThan(500);
  expect(outcome.body).toHaveProperty("_tag");
  expect(typeof (outcome.body as { _tag: unknown })._tag).toBe("string");
};

const statusAndBody = (outcome: Outcome) => ({ status: outcome.status, body: outcome.body });

describe("パスキーの登録の API", () => {
  afterEach(async () => {
    setSystemTime();
    await forgetScenario();
  });

  test("MFA を有効にしていない user が options の challenge で署名した応答を送ると、送った credential の行が 1 つだけ増えて一覧に出る", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const listedBefore = await readListedIds(session);

    const options = optionsOf(await requestOptions(session));
    const signed = signedResponse(options.challenge);
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
    const listedAfter = await readListedIds(session);
    expect(listedAfter).toHaveLength(listedBefore.length + 1);
  });

  test("options の応答は cookie を設定せず、登録は署名した応答だけで成功する", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);

    const optionsOutcome = await requestOptions(session);
    const outcome = await sendRegistration(
      session,
      signedResponse(optionsOf(optionsOutcome).challenge).response,
    );

    expect(optionsOutcome.setCookies).toEqual([]);
    expect(outcome.status).toBe(200);
  });

  test("登録に使った challenge で署名した別の credential の応答は失敗し、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const { challenge } = optionsOf(await requestOptions(session));
    const first = signedResponse(challenge);
    expect((await sendRegistration(session, first.response)).status).toBe(200);

    const second = await sendRegistration(session, signedResponse(challenge).response);

    expectKnownClientFailure(second);
    expect(await savedCredentialIdsOf(owner)).toEqual([first.made.id]);
  });

  test("options を取ってから 5 分が経つ 1 秒前に送った応答は成功する", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const issuedAt = Date.now();
    const { challenge } = optionsOf(await requestOptions(session));

    setSystemTime(new Date(issuedAt + CHALLENGE_LIFETIME_MS - ONE_SECOND_MS));
    const signed = signedResponse(challenge);
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
  });

  test("options を取ってから 5 分を 1 秒過ぎて送った応答は失敗し、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const issuedAt = Date.now();
    const { challenge } = optionsOf(await requestOptions(session));

    setSystemTime(new Date(issuedAt + CHALLENGE_LIFETIME_MS + ONE_SECOND_MS));
    const outcome = await sendRegistration(session, signedResponse(challenge).response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("ほかの user が取った challenge で署名した応答を自分の session で送ると失敗し、どちらの user の行も増えない", async () => {
    const issuer = await createUser("issuer");
    const intruder = await createUser("intruder");
    const { challenge } = optionsOf(await requestOptions(openSession(issuer)));

    const outcome = await sendRegistration(
      openSession(intruder),
      signedResponse(challenge).response,
    );

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(issuer)).toEqual([]);
    expect(await savedCredentialIdsOf(intruder)).toEqual([]);
  });

  test("生体か PIN の確認の無い応答で失敗した後は、同じ challenge で署名した正しい応答も失敗し、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const { challenge } = optionsOf(await requestOptions(session));
    expectKnownClientFailure(
      await sendRegistration(session, signedResponse(challenge, { userVerified: false }).response),
    );

    const outcome = await sendRegistration(session, signedResponse(challenge).response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("MFA が有効な user の options は既知の失敗になり、challenge を返さず、TTL store にもその user の challenge を置かない", async () => {
    const owner = await createMfaEnabledUser("mfa-owner");
    const heldBefore = ttlValuesHolding(owner.id);

    const outcome = await requestOptions(openSession(owner));

    expectKnownClientFailure(outcome);
    expect(outcome.body).not.toHaveProperty("challenge");
    expect(ttlValuesHolding(owner.id)).toBe(heldBefore);
  });

  test("自分が既に保存した credential の応答は既知の失敗になり、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const { challenge } = optionsOf(await requestOptions(session));
    const signed = signedResponse(challenge);
    await saveCredential(owner, signed.made.id);

    const outcome = await sendRegistration(session, signed.response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
  });

  test("ほかの user が既に保存した credential の応答は既知の失敗になり、どちらの user の行も増えない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const session = openSession(owner);
    const { challenge } = optionsOf(await requestOptions(session));
    const signed = signedResponse(challenge);
    await saveCredential(other, signed.made.id);

    const outcome = await sendRegistration(session, signed.response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
    expect(await savedCredentialIdsOf(other)).toEqual([signed.made.id]);
  });

  test("options の除外の一覧には、自分が保存した credential がすべて挙がり、ほかの user の credential は挙がらない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const own = [await saveSomeCredential(owner), await saveSomeCredential(owner)];
    const others = await saveSomeCredential(other);

    const options = optionsOf(await requestOptions(openSession(owner)));

    const excluded = options.excludeCredentials.map(({ id }) => id);
    expect(excluded.toSorted()).toEqual(own.toSorted());
    expect(excluded).not.toContain(others);
  });

  test("同じ session で options を 10 回取るまでは成功し、11 回目は既存の API が試行枠を超えた時と同じ失敗になる", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);

    const statuses: number[] = [];
    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++)
      statuses.push((await requestOptions(session)).status);
    const exceeded = await requestOptions(session);

    expect(statuses).toEqual(Array(ATTEMPTS_PER_MINUTE).fill(200));
    expect(statusAndBody(exceeded)).toEqual(RATE_LIMITED);
  });

  test("同じ session で登録の要求を 10 回送った後、11 回目は試行枠を超えた失敗になる", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const { challenge } = optionsOf(await requestOptions(openSession(owner)));

    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++) {
      await sendRegistration(session, signedResponse(challenge).response);
    }
    const exceeded = await sendRegistration(session, signedResponse(challenge).response);

    expect(statusAndBody(exceeded)).toEqual(RATE_LIMITED);
  });

  test("同じ session で一覧を 10 回読んだ後は、options も試行枠を超えた失敗になる", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++) await readListedIds(session);

    const outcome = await requestOptions(session);

    expect(statusAndBody(outcome)).toEqual(RATE_LIMITED);
  });

  test("TTL store で試行の回数を数えられない時も、options を取って登録を終えられる", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner, { trouble: "uncountable" });

    const options = optionsOf(await requestOptions(session));
    const signed = signedResponse(options.challenge);
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
  });

  test("session の無い options と登録の要求は、既存のログイン済みの API と同じ status と本文の失敗になる", async () => {
    const existing = await postExistingSignedInApiWithoutSession();
    const options = await requestOptionsWithoutSession();
    const registration = await sendRegistrationWithoutSession(
      signedResponse("Y2hhbGxlbmdl").response,
    );

    expect(statusAndBody(options)).toEqual(statusAndBody(existing));
    expect(statusAndBody(registration)).toEqual(statusAndBody(existing));
  });

  test("cross-site の form の要求で options を取るか登録の要求を送ると、既存のログイン済みの POST と同じく 403 になる", async () => {
    const owner = await createUser("owner");

    const statuses = await crossSiteStatuses(openSession(owner));

    expect(statuses.existing).toBe(403);
    expect(statuses.options).toBe(403);
    expect(statuses.register).toBe(403);
  });

  test("生体か PIN の確認の無い応答と、auth ホストと違う origin の応答は、どちらも 400 で同じ本文の失敗になる", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const first = optionsOf(await requestOptions(session)).challenge;
    const second = optionsOf(await requestOptions(session)).challenge;

    const unverified = await sendRegistration(
      session,
      signedResponse(first, { userVerified: false }).response,
    );
    const foreign = await sendRegistration(
      session,
      signedResponse(second, { origin: OTHER_ORIGIN }).response,
    );

    expect(unverified.status).toBe(400);
    expect(foreign.status).toBe(400);
    expect(foreign.body).toEqual(unverified.body);
  });

  test("clientDataJSON の challenge が文字列でない応答は、確認の無い応答と同じ 400 の失敗になる", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const first = optionsOf(await requestOptions(session)).challenge;
    const second = optionsOf(await requestOptions(session)).challenge;
    const unverified = await sendRegistration(
      session,
      signedResponse(first, { userVerified: false }).response,
    );

    const outcome = await sendRegistration(
      session,
      withChallengeReplacedBy(signedResponse(second).response, 42),
    );

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual(unverified.body);
  });

  test("TTL store で challenge を取り出せない時の登録は、4xx でなく 5xx の失敗になり、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = openSession(owner);
    const { challenge } = optionsOf(await requestOptions(session));

    const outcome = await sendRegistration(
      sameSessionWithTrouble(session, "challenge-unreadable"),
      signedResponse(challenge).response,
    );

    expect(outcome.status).toBeGreaterThanOrEqual(500);
    expect(outcome.status).toBeLessThan(600);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });
});
