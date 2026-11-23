import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Layer } from "effect";
import { auditRowsFor, dbTest, partial } from "../../__tests__/live-runner";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { TestDb } from "../../__tests__/test-db";
import { auditFailingLayer } from "../../__tests__/test-layers";
import {
  ttlStoreWithoutChallengeLookup,
  ttlStoreWithoutCounting,
  ttlValuesHolding,
} from "../../__tests__/test-ttl-store";
import { signedIn } from "../../membership/__tests__/test-layers";
import { enableMfaFor, totpCode, wrongTotpCode } from "../../mfa/__tests__/helpers";
import { MfaTotpRepo } from "../../mfa/totp/ports";
import { EmailSenderLive } from "../../email/wiring";
import { passkeysOf, passkeyToSave, savePasskey } from "../../passkey/__tests__/helpers";
import { PasskeyRepo } from "../../passkey/ports";
import { JSON_HEADERS } from "../client-facing-error";
import {
  awaitingBackground,
  buildAppWith,
  challengeOf,
  defectDuringPasskeyMail,
  CLIENT_IP,
  CLIENT_USER_AGENT,
  clientHeaders,
  freshSessionCookie,
  inBackgroundScope,
  listedPasskeyIds,
  type Outcome,
  postJson,
  readMfaStatus,
  requestRegistrationOptions,
  requestRegistrationOptionsWith,
  resendOutbox,
  restoreKvStoreAfterEach,
  SECURITY_PAGE_URL,
  sameOriginHeaders,
  sendMfaDisable,
  sendRegistration,
  type SignedInSession,
  type SignedInUser,
  signedInSession,
  signedRegistrationFor,
  statusAndBody,
} from "./helpers";

const clientData = Buffer.from(
  JSON.stringify({
    type: "webauthn.create",
    challenge: "bm90LWlzc3VlZC1ieS10aGlzLXNlcnZlci0wMDAwMDAwMDA",
    origin: "https://unused.example",
  }),
).toString("base64url");

const browserShapedResponse = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  authenticatorAttachment: null,
  clientExtensionResults: { credProps: { rk: true } },
  response: {
    clientDataJSON: clientData,
    attestationObject: "o2NmbXRkbm9uZQ",
    authenticatorData: Buffer.from("authenticator-data").toString("base64url"),
    publicKey: Buffer.from("public-key").toString("base64url"),
    publicKeyAlgorithm: -7,
    transports: ["internal", "hybrid", "some-future-transport"],
  },
};

const register = (body: unknown, app = buildAppWith(signedIn())) =>
  app.request("/api/account/passkeys", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "sec-fetch-site": "same-origin",
      ...freshSessionCookie(),
    },
    body: JSON.stringify(body),
  });

describe("パスキーの登録の要求の形", () => {
  test("browser の toJSON() が足す鍵、null の authenticatorAttachment、未知の transports を含む応答は、要求の形の検査を通って検証で落ちる", async () => {
    const res = await register(browserShapedResponse);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(JSON.stringify({ _tag: "PasskeyRejected" }));
  });

  test("response を欠く要求は、検証に届かず要求の形の検査で落ちる", async () => {
    const { response: _dropped, ...withoutResponse } = browserShapedResponse;

    const res = await register(withoutResponse);

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("PasskeyRejected");
  });

  test("options の応答は、browser の作成の dialog が要る鍵を、生体か PIN の必須と登録済みの credential の除外を含めて返し、dialog は challenge の 5 分より先に切れる", async () => {
    const registered = {
      credentialId: "cmVnaXN0ZXJlZC1jcmVkZW50aWFs",
      transports: ["internal", "hybrid"] as Array<"internal" | "hybrid">,
    };
    const app = buildAppWith(
      Layer.mergeAll(
        signedIn("u-options", "owner@example.com"),
        Layer.succeed(
          MfaTotpRepo,
          partial<MfaTotpRepo["Service"]>({ readMfaStatusRow: () => Effect.succeed(undefined) }),
        ),
        Layer.succeed(
          PasskeyRepo,
          partial<PasskeyRepo["Service"]>({
            listPasskeys: () =>
              Effect.succeed([
                {
                  ...registered,
                  id: "pk-1",
                  userId: "u-options",
                  publicKey: new Uint8Array([1]),
                  counter: 0,
                  aaguid: "00000000-0000-0000-0000-000000000000",
                  createdAt: new Date(),
                  lastUsedAt: null,
                },
              ]),
          }),
        ),
      ),
    );

    const res = await app.request("/api/account/passkeys/registration-options", {
      method: "POST",
      headers: { ...JSON_HEADERS, "sec-fetch-site": "same-origin", ...freshSessionCookie() },
      body: "{}",
    });

    expect(res.status).toBe(200);
    const body: { readonly timeout?: number } = await res.json();
    expect(body).toMatchObject({
      rp: { id: new URL(process.env.AUTH_SERVICE_URL ?? "").hostname },
      user: {
        id: Buffer.from("u-options").toString("base64url"),
        name: "owner@example.com",
        displayName: "owner@example.com",
      },
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: { userVerification: "required", residentKey: "required" },
      excludeCredentials: [
        { id: registered.credentialId, type: "public-key", transports: registered.transports },
      ],
      extensions: { credProps: true },
    });
    expect(body.timeout).toBeLessThan(5 * 60 * 1000);
  });
  test("同時の登録で 11 本になった user の options も、上限の失敗になる", async () => {
    const app = buildAppWith(
      Layer.mergeAll(
        signedIn("u-over-limit", "owner@example.com"),
        Layer.succeed(
          PasskeyRepo,
          partial<PasskeyRepo["Service"]>({
            listPasskeys: () =>
              Effect.succeed(
                Array.from({ length: 11 }, (_, index) => ({
                  id: `pk-${index}`,
                  userId: "u-over-limit",
                  credentialId: `credential-${index}`,
                  transports: ["internal"] as Array<"internal">,
                  publicKey: new Uint8Array([1]),
                  counter: 0,
                  aaguid: "00000000-0000-0000-0000-000000000000",
                  createdAt: new Date(),
                  lastUsedAt: null,
                })),
              ),
          }),
        ),
      ),
    );

    const res = await app.request("/api/account/passkeys/registration-options", {
      method: "POST",
      headers: { ...JSON_HEADERS, "sec-fetch-site": "same-origin", ...freshSessionCookie() },
      body: "{}",
    });

    expect(res.status).toBe(409);
    expect(await res.text()).toBe(JSON.stringify({ _tag: "PasskeyLimitReached" }));
  });
});

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

describe("パスキーの登録の API を、保存した行と challenge の寿命から確かめる", () => {
  const { run, cleanup } = dbTest("passkey-registration-test-");
  const sentry = recordSentry();
  restoreKvStoreAfterEach();
  afterEach(async () => {
    setSystemTime();
    sentry.reset();
    await cleanup();
  });

  const registeredAuditsOf = async (user: { readonly id: string }) =>
    (await run(auditRowsFor(user.id, "passkey_registered"))).map((row) => row.payload);

  const failingAudit = auditFailingLayer(new Error("audit store unavailable"));

  const createUser = (name: string) =>
    run(TestDb.use((db) => db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`)));

  const createMfaEnabledUser = (name: string) =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) =>
          db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`),
        );
        yield* enableMfaFor(user);
        return user;
      }),
    );

  const savedCredentialIdsOf = async (user: { readonly id: string }) =>
    (await run(passkeysOf(user.id))).map(({ credentialId }) => credentialId);

  const saveCredential = async (user: { readonly id: string }, credentialId: string) => {
    const saved = await run(savePasskey(user.id, { ...passkeyToSave(), credentialId }));
    if (!saved) throw new Error("パスキーを保存できなかった");
  };

  const saveSomeCredential = async (user: { readonly id: string }) => {
    const { credentialId } = passkeyToSave();
    await saveCredential(user, credentialId);
    return credentialId;
  };

  const withChallengeReplacedBy = (
    response: ReturnType<typeof signedRegistrationFor>["response"],
    challenge: unknown,
  ) => {
    const clientDataJson = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return {
      ...response,
      response: {
        ...response.response,
        clientDataJSON: Buffer.from(JSON.stringify({ ...clientDataJson, challenge })).toString(
          "base64url",
        ),
      },
    };
  };

  const crossSiteStatuses = async (session: SignedInSession) => {
    const headers = {
      cookie: session.cookie,
      "sec-fetch-site": "cross-site",
      "content-type": "application/x-www-form-urlencoded",
    };
    return {
      options: (
        await postJson(session.app, "/api/account/passkeys/registration-options", headers, "")
      ).status,
      register: (await postJson(session.app, "/api/account/passkeys", headers, "")).status,
      existing: (await postJson(session.app, "/api/account/mfa/enroll", headers, "")).status,
    };
  };

  test("MFA を有効にしていない user が options の challenge で署名した応答を送ると、送った credential の行が 1 つだけ増えて一覧に出る", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const listedBefore = await listedPasskeyIds(session);

    const options = challengeOf(await requestRegistrationOptions(session));
    const signed = signedRegistrationFor(options);
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
    const listedAfter = await listedPasskeyIds(session);
    expect(listedAfter).toHaveLength(listedBefore.length + 1);
  });

  test("options の応答は cookie を設定せず、登録は署名した応答だけで成功する", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);

    const optionsOutcome = await requestRegistrationOptions(session);
    const outcome = await sendRegistration(
      session,
      signedRegistrationFor(challengeOf(optionsOutcome)).response,
    );

    expect(optionsOutcome.setCookies).toEqual([]);
    expect(outcome.status).toBe(200);
  });

  test("登録に使った challenge で署名した別の credential の応答は失敗し、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(session));
    const first = signedRegistrationFor(challenge);
    expect((await sendRegistration(session, first.response)).status).toBe(200);

    const second = await sendRegistration(session, signedRegistrationFor(challenge).response);

    expectKnownClientFailure(second);
    expect(await savedCredentialIdsOf(owner)).toEqual([first.made.id]);
  });

  test("options を取ってから 5 分が経つ 1 秒前に送った応答は成功する", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const issuedAt = Date.now();
    const challenge = challengeOf(await requestRegistrationOptions(session));

    setSystemTime(new Date(issuedAt + CHALLENGE_LIFETIME_MS - ONE_SECOND_MS));
    const signed = signedRegistrationFor(challenge);
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
  });

  test("options を取ってから 5 分を 1 秒過ぎて送った応答は失敗し、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const issuedAt = Date.now();
    const challenge = challengeOf(await requestRegistrationOptions(session));

    setSystemTime(new Date(issuedAt + CHALLENGE_LIFETIME_MS + ONE_SECOND_MS));
    const outcome = await sendRegistration(session, signedRegistrationFor(challenge).response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("ほかの user が取った challenge で署名した応答を自分の session で送ると失敗し、どちらの user の行も増えない", async () => {
    const issuer = await createUser("issuer");
    const intruder = await createUser("intruder");
    const challenge = challengeOf(await requestRegistrationOptions(signedInSession(issuer)));

    const outcome = await sendRegistration(
      signedInSession(intruder),
      signedRegistrationFor(challenge).response,
    );

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(issuer)).toEqual([]);
    expect(await savedCredentialIdsOf(intruder)).toEqual([]);
  });

  test("生体か PIN の確認の無い応答で失敗した後は、同じ challenge で署名した正しい応答も失敗し、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(session));
    expectKnownClientFailure(
      await sendRegistration(
        session,
        signedRegistrationFor(challenge, { userVerified: false }).response,
      ),
    );

    const outcome = await sendRegistration(session, signedRegistrationFor(challenge).response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("MFA が有効な user の options は既知の失敗になり、challenge を返さず、TTL store にもその user の challenge を置かない", async () => {
    const owner = await createMfaEnabledUser("mfa-owner");
    const heldBefore = ttlValuesHolding(owner.id);

    const outcome = await requestRegistrationOptions(signedInSession(owner));

    expectKnownClientFailure(outcome);
    expect(outcome.body).not.toHaveProperty("challenge");
    expect(ttlValuesHolding(owner.id)).toBe(heldBefore);
  });

  test("自分が既に保存した credential の応答は既知の失敗になり、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(session));
    const signed = signedRegistrationFor(challenge);
    await saveCredential(owner, signed.made.id);

    const outcome = await sendRegistration(session, signed.response);

    expectKnownClientFailure(outcome);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
  });

  test("ほかの user が既に保存した credential の応答は既知の失敗になり、どちらの user の行も増えない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(session));
    const signed = signedRegistrationFor(challenge);
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

    const outcome = await requestRegistrationOptions(signedInSession(owner));

    expect(outcome.status).toBe(200);
    const excluded = (
      outcome.body as { excludeCredentials: ReadonlyArray<{ readonly id: string }> }
    ).excludeCredentials.map(({ id }) => id);
    expect(excluded.toSorted()).toEqual(own.toSorted());
    expect(excluded).not.toContain(others);
  });

  test("同じ session で options を 10 回取るまでは成功し、11 回目は既存の API が試行枠を超えた時と同じ失敗になる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);

    const statuses: number[] = [];
    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++)
      statuses.push((await requestRegistrationOptions(session)).status);
    const exceeded = await requestRegistrationOptions(session);

    expect(statuses).toEqual(Array(ATTEMPTS_PER_MINUTE).fill(200));
    expect(statusAndBody(exceeded)).toEqual(RATE_LIMITED);
  });

  test("同じ session で登録の要求を 10 回送った後、11 回目は試行枠を超えた失敗になる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(signedInSession(owner)));

    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++) {
      await sendRegistration(session, signedRegistrationFor(challenge).response);
    }
    const exceeded = await sendRegistration(session, signedRegistrationFor(challenge).response);

    expect(statusAndBody(exceeded)).toEqual(RATE_LIMITED);
  });

  test("同じ session で一覧を 10 回読んだ後は、options も試行枠を超えた失敗になる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++) await listedPasskeyIds(session);

    const outcome = await requestRegistrationOptions(session);

    expect(statusAndBody(outcome)).toEqual(RATE_LIMITED);
  });

  test("TTL store で試行の回数を数えられない時も、options を取って登録を終えられる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner, { layer: ttlStoreWithoutCounting });

    const challenge = challengeOf(await requestRegistrationOptions(session));
    const signed = signedRegistrationFor(challenge);
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual([signed.made.id]);
  });

  test("cross-site の form の要求で options を取るか登録の要求を送ると、既存のログイン済みの POST と同じく 403 になる", async () => {
    const owner = await createUser("owner");

    const statuses = await crossSiteStatuses(signedInSession(owner));

    expect(statuses.existing).toBe(403);
    expect(statuses.options).toBe(403);
    expect(statuses.register).toBe(403);
  });

  test("生体か PIN の確認の無い応答と、auth ホストと違う origin の応答は、どちらも 400 で同じ本文の失敗になる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const first = challengeOf(await requestRegistrationOptions(session));
    const second = challengeOf(await requestRegistrationOptions(session));

    const unverified = await sendRegistration(
      session,
      signedRegistrationFor(first, { userVerified: false }).response,
    );
    const foreign = await sendRegistration(
      session,
      signedRegistrationFor(second, { origin: OTHER_ORIGIN }).response,
    );

    expect(unverified.status).toBe(400);
    expect(foreign.status).toBe(400);
    expect(foreign.body).toEqual(unverified.body);
  });

  test("clientDataJSON の challenge が文字列でない応答は、確認の無い応答と同じ 400 の失敗になる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const first = challengeOf(await requestRegistrationOptions(session));
    const second = challengeOf(await requestRegistrationOptions(session));
    const unverified = await sendRegistration(
      session,
      signedRegistrationFor(first, { userVerified: false }).response,
    );

    const outcome = await sendRegistration(
      session,
      withChallengeReplacedBy(signedRegistrationFor(second).response, 42),
    );

    expect(outcome.status).toBe(400);
    expect(outcome.body).toEqual(unverified.body);
  });

  test("TTL store で challenge を取り出せない時の登録は、4xx でなく 5xx の失敗になり、行が増えない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(session));

    const outcome = await sendRegistration(
      signedInSession(owner, { layer: ttlStoreWithoutChallengeLookup, cookie: session.cookie }),
      signedRegistrationFor(challenge).response,
    );

    expect(outcome.status).toBeGreaterThanOrEqual(500);
    expect(outcome.status).toBeLessThan(600);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("同じ session で options を 10 回取った後も、MFA の有効化の開始は試行枠の失敗にならない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    for (let i = 0; i < ATTEMPTS_PER_MINUTE; i++) await requestRegistrationOptions(session);

    const enrollment = await postJson(
      session.app,
      "/api/account/mfa/enroll",
      sameOriginHeaders(session.cookie),
      "{}",
    );

    expect(enrollment.status).not.toBe(429);
    expect(enrollment.status).toBeLessThan(500);
  });
  const saveCredentials = async (user: { readonly id: string }, count: number) => {
    for (let i = 0; i < count; i++) await saveSomeCredential(user);
  };

  test("パスキーが 10 本ある user の options は既知の失敗になり、challenge を返さず、TTL store にもその user の challenge を置かない", async () => {
    const owner = await createUser("owner");
    await saveCredentials(owner, 10);
    const heldBefore = ttlValuesHolding(owner.id);

    const outcome = await requestRegistrationOptions(signedInSession(owner));

    expectKnownClientFailure(outcome);
    expect(outcome.body).not.toHaveProperty("challenge");
    expect(ttlValuesHolding(owner.id)).toBe(heldBefore);
  });

  test("9 本の時に取った challenge で署名した応答を、10 本になった後に送ると既知の失敗になり、行は 10 本のまま増えない", async () => {
    const owner = await createUser("owner");
    await saveCredentials(owner, 9);
    const session = signedInSession(owner);
    const challenge = challengeOf(await requestRegistrationOptions(session));
    await saveCredentials(owner, 1);
    const savedBefore = await savedCredentialIdsOf(owner);

    const outcome = await sendRegistration(session, signedRegistrationFor(challenge).response);

    expectKnownClientFailure(outcome);
    expect(savedBefore).toHaveLength(10);
    expect(await savedCredentialIdsOf(owner)).toEqual(savedBefore);
  });

  test("パスキーが 9 本ある user は、options を取って署名した応答を送ると登録でき、10 本になる", async () => {
    const owner = await createUser("owner");
    await saveCredentials(owner, 9);
    const session = signedInSession(owner);

    const signed = signedRegistrationFor(challengeOf(await requestRegistrationOptions(session)));
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    const saved = await savedCredentialIdsOf(owner);
    expect(saved).toHaveLength(10);
    expect(saved).toContain(signed.made.id);
  });

  const LIMIT_REACHED = { status: 409, body: { _tag: "PasskeyLimitReached" } };

  test("MFA が有効な user も、10 本あれば options の失敗は上限を表す", async () => {
    const owner = await createMfaEnabledUser("mfa-owner");
    await saveCredentials(owner, 10);

    const outcome = await requestRegistrationOptions(signedInSession(owner));

    expect(statusAndBody(outcome)).toEqual(LIMIT_REACHED);
  });

  test("10 本になった後に送った新しい credential の応答の失敗は上限を表し、9 本以下で送った保存済みの credential の応答の失敗は登録済みを表す", async () => {
    const full = await createUser("full");
    const roomy = await createUser("roomy");
    await saveCredentials(full, 9);
    const fullSession = signedInSession(full);
    const roomySession = signedInSession(roomy);
    const fullChallenge = challengeOf(await requestRegistrationOptions(fullSession));
    const duplicate = signedRegistrationFor(
      challengeOf(await requestRegistrationOptions(roomySession)),
    );
    await saveCredentials(full, 1);
    await saveCredential(roomy, duplicate.made.id);

    const refusedByLimit = await sendRegistration(
      fullSession,
      signedRegistrationFor(fullChallenge).response,
    );
    const refusedAsDuplicate = await sendRegistration(roomySession, duplicate.response);

    expect(statusAndBody(refusedByLimit)).toEqual(LIMIT_REACHED);
    expect(statusAndBody(refusedAsDuplicate)).toEqual({
      status: 409,
      body: { _tag: "PasskeyAlreadyRegistered" },
    });
  });

  test("要求の IP と userAgent を付けてパスキーを登録すると、登録の記録が 1 件だけ増え、一覧に出たパスキーの id、送った credential の aaguid、要求の IP と userAgent を持つ", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const signed = signedRegistrationFor(challengeOf(await requestRegistrationOptions(session)));

    const outcome = await sendRegistration(session, signed.response, clientHeaders);

    expect(outcome.status).toBe(200);
    const [listed] = await listedPasskeyIds(session);
    expect(await registeredAuditsOf(owner)).toEqual([
      {
        passkey_id: listed,
        aaguid: signed.made.aaguid,
        ip: CLIENT_IP,
        userAgent: CLIENT_USER_AGENT,
      },
    ]);
  });

  test("自分が既に保存した credential を送って登録を拒否された時は、登録の記録が増えない", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner);
    const signed = signedRegistrationFor(challengeOf(await requestRegistrationOptions(session)));
    await saveCredential(owner, signed.made.id);

    const outcome = await sendRegistration(session, signed.response);

    expectKnownClientFailure(outcome);
    expect(await registeredAuditsOf(owner)).toEqual([]);
  });

  test("audit の記帳が失敗する時も、登録の応答は成功で、パスキーは一覧に出る", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner, { layer: failingAudit });
    const signed = signedRegistrationFor(challengeOf(await requestRegistrationOptions(session)));

    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await listedPasskeyIds(session)).toHaveLength(1);
  });

  test("audit の記帳が失敗した登録は、登録の event として Sentry に送られる", async () => {
    const owner = await createUser("owner");
    const session = signedInSession(owner, { layer: failingAudit });
    const signed = signedRegistrationFor(challengeOf(await requestRegistrationOptions(session)));

    await sendRegistration(session, signed.response);

    expect(sentry.auditFailureEvents()).toEqual(["passkey_registered"]);
  });

  describe("通知メール", () => {
    const resend = resendOutbox();
    const GOOGLE_PROVIDER_AAGUID = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4";

    const mailingSession = (user: SignedInUser, layer: Layer.Layer<never> = Layer.empty) =>
      signedInSession(user, { layer: Layer.merge(EmailSenderLive, layer) });

    const signedFor = async (session: SignedInSession, aaguid?: string) =>
      signedRegistrationFor(
        challengeOf(await requestRegistrationOptions(session)),
        aaguid === undefined ? {} : { aaguid },
      );

    const register = async (
      session: SignedInSession,
      overrides: { readonly aaguid?: string; readonly headers?: Record<string, string> } = {},
    ) => {
      const signed = await signedFor(session, overrides.aaguid);
      return awaitingBackground(() =>
        sendRegistration(session, signed.response, overrides.headers),
      );
    };

    test("パスキーを登録すると、登録した user のメールアドレスへ通知メールが 1 通だけ送られる", async () => {
      const owner = await createUser("owner");

      const outcome = await register(mailingSession(owner));

      expect(outcome.status).toBe(200);
      expect(resend.recipients()).toEqual([owner.email]);
    });

    test("自分が既に保存した credential を送って登録を拒否された時は、通知メールを送らない", async () => {
      const owner = await createUser("owner");
      const session = mailingSession(owner);
      const signed = await signedFor(session);
      await saveCredential(owner, signed.made.id);

      const outcome = await awaitingBackground(() => sendRegistration(session, signed.response));

      expectKnownClientFailure(outcome);
      expect(resend.delivered).toEqual([]);
    });

    test("パスキーが 10 本になった後に新しい credential を送って登録を拒否された時は、通知メールを送らない", async () => {
      const owner = await createUser("owner");
      const session = mailingSession(owner);
      const signed = await signedFor(session);
      await saveCredentials(owner, 10);

      const outcome = await awaitingBackground(() => sendRegistration(session, signed.response));

      expect(statusAndBody(outcome)).toEqual(LIMIT_REACHED);
      expect(resend.delivered).toEqual([]);
    });

    test("audit の記帳が失敗する時も、登録した user へ通知メールが 1 通送られる", async () => {
      const owner = await createUser("owner");

      const outcome = await register(mailingSession(owner, failingAudit));

      expect(outcome.status).toBe(200);
      expect(resend.recipients()).toEqual([owner.email]);
    });

    test("提供元の表にある credential を登録した通知メールには、提供元の名前と、セキュリティの画面で削除する手順がある", async () => {
      const owner = await createUser("owner");

      await register(mailingSession(owner), { aaguid: GOOGLE_PROVIDER_AAGUID });

      const [mail] = resend.delivered;
      expect(mail?.html).toContain("Google パスワードマネージャー");
      expect(mail?.text).toContain("Google パスワードマネージャー");
      expect(mail?.text).toContain(SECURITY_PAGE_URL);
      expect(mail?.text).toContain("削除してください");
    });

    test("User-Agent に HTML の tag を含む要求で登録しても、通知メールの HTML に tag がそのまま出ない", async () => {
      const owner = await createUser("owner");
      const tag = "<script>alert(1)</script>";

      await register(mailingSession(owner), { headers: { "user-agent": tag } });

      expect(resend.delivered).toHaveLength(1);
      expect(resend.delivered[0]?.html).not.toContain(tag);
    });

    test("Resend への送信が終わらないうちに登録の応答が成功で返り、送信が終わると通知メールが 1 通届く", async () => {
      const owner = await createUser("owner");
      const session = mailingSession(owner);
      const signed = await signedFor(session);
      const release = resend.held();

      const { result: outcome, settled } = await inBackgroundScope(() =>
        sendRegistration(session, signed.response),
      );

      expect(outcome.status).toBe(200);
      expect(resend.delivered).toEqual([]);
      release();
      await settled();
      expect(resend.recipients()).toEqual([owner.email]);
    });

    test("Resend への送信が失敗する時も、登録の応答は成功で、パスキーは一覧に出る", async () => {
      const owner = await createUser("owner");
      const session = mailingSession(owner);
      resend.failing();

      const outcome = await register(session);

      expect(outcome.status).toBe(200);
      expect(await listedPasskeyIds(session)).toHaveLength(1);
    });

    test("通知メールの送信が型の無い例外で落ちる時も、登録の応答は成功で、パスキーは一覧に出て、Sentry に warning として 1 件送られる", async () => {
      const owner = await createUser("owner");
      const session = signedInSession(owner, { layer: defectDuringPasskeyMail });

      const outcome = await register(session);

      expect(outcome.status).toBe(200);
      expect(await listedPasskeyIds(session)).toHaveLength(1);
      expect(sentry.warnings()).toHaveLength(1);
    });

    test("Resend への送信が失敗した登録は、Sentry に warning として 1 件送られる", async () => {
      const owner = await createUser("owner");
      resend.failing();

      await register(mailingSession(owner));

      expect(sentry.warnings()).toHaveLength(1);
    });
  });
});

describe("MFA が有効な user の登録の前の TOTP の確認", () => {
  const { run, cleanup } = dbTest("passkey-registration-totp-test-");
  restoreKvStoreAfterEach();
  afterEach(cleanup);

  const createMfaEnabledUser = (name: string) =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) =>
          db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`),
        );
        const enabled = yield* enableMfaFor(user);
        return { user, secret: enabled.secret, recoveryCodes: enabled.recoveryCodes };
      }),
    );

  const createUser = (name: string) =>
    run(TestDb.use((db) => db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`)));

  const currentCode = (secret: string) => Effect.runPromise(totpCode(secret));
  const wrongCode = (secret: string) => Effect.runPromise(wrongTotpCode(secret));

  const savedCredentialIdsOf = async (user: { readonly id: string }) =>
    (await run(passkeysOf(user.id))).map(({ credentialId }) => credentialId);

  test("MFA が有効な user が正しい TOTP のコードを載せると options が返り、その challenge で署名した応答で登録できる", async () => {
    const { user, secret } = await createMfaEnabledUser("totp-owner");
    const session = signedInSession(user);

    const options = await requestRegistrationOptionsWith(session, {
      totp_code: await currentCode(secret),
    });
    const signed = signedRegistrationFor(challengeOf(options));
    const outcome = await sendRegistration(session, signed.response);

    expect(outcome.status).toBe(200);
    expect(await savedCredentialIdsOf(user)).toEqual([signed.made.id]);
  });

  test("誤った TOTP のコードを載せた options は既知の失敗になり、challenge を返さず、TTL store にもその user の challenge を置かない", async () => {
    const { user, secret } = await createMfaEnabledUser("wrong-code");
    const heldBefore = ttlValuesHolding(user.id);

    const outcome = await requestRegistrationOptionsWith(signedInSession(user), {
      totp_code: await wrongCode(secret),
    });

    expectKnownClientFailure(outcome);
    expect(outcome.body).not.toHaveProperty("challenge");
    expect(ttlValuesHolding(user.id)).toBe(heldBefore);
  });

  test("1 度使った TOTP のコードを同じ時間枠でもう 1 度載せた options は既知の失敗になり、challenge を置かない", async () => {
    const { user, secret } = await createMfaEnabledUser("reused-code");
    const session = signedInSession(user);
    const code = await currentCode(secret);
    challengeOf(await requestRegistrationOptionsWith(session, { totp_code: code }));
    const heldAfterFirst = ttlValuesHolding(user.id);

    const outcome = await requestRegistrationOptionsWith(session, { totp_code: code });

    expectKnownClientFailure(outcome);
    expect(ttlValuesHolding(user.id)).toBe(heldAfterFirst);
  });

  test("リカバリーコードを載せた options は既知の失敗になり、未使用のリカバリーコードの数が変わらない", async () => {
    const { user, recoveryCodes } = await createMfaEnabledUser("recovery-code");
    const session = signedInSession(user);
    const [recoveryCode] = recoveryCodes;
    if (recoveryCode === undefined) throw new Error("リカバリーコードが無い");
    const remainingBefore = (await readMfaStatus(session)).recovery_codes_remaining;

    const asTotp = await requestRegistrationOptionsWith(session, { totp_code: recoveryCode });
    const asRecoveryKind = await requestRegistrationOptionsWith(session, {
      code: recoveryCode,
      kind: "recovery_code",
    });

    expectKnownClientFailure(asTotp);
    expectKnownClientFailure(asRecoveryKind);
    expect((await readMfaStatus(session)).recovery_codes_remaining).toBe(remainingBefore);
  });

  test("MFA の無効化の誤り 2 回と登録の誤ったコード 3 回の後は、MFA の無効化に正しいコードを送ってもロックされ、MFA は有効のまま", async () => {
    const { user, secret } = await createMfaEnabledUser("shared-budget");
    const session = signedInSession(user);

    for (let attempt = 0; attempt < 2; attempt++) {
      await sendMfaDisable(session, await wrongCode(secret));
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      await requestRegistrationOptionsWith(session, { totp_code: await wrongCode(secret) });
    }
    const outcome = await sendMfaDisable(session, await currentCode(secret));

    expect(statusAndBody(outcome)).toEqual({ status: 429, body: { _tag: "Locked" } });
    expect((await readMfaStatus(session)).enabled).toBe(true);
  });

  test("MFA の無効化の誤りを 5 回続けた後は、正しいコードを載せた options も既知の失敗になり、challenge を置かない", async () => {
    const { user, secret } = await createMfaEnabledUser("disable-locked");
    const session = signedInSession(user);
    for (let attempt = 0; attempt < 5; attempt++) {
      await sendMfaDisable(session, await wrongCode(secret));
    }
    const heldBefore = ttlValuesHolding(user.id);

    const outcome = await requestRegistrationOptionsWith(session, {
      totp_code: await currentCode(secret),
    });

    expectKnownClientFailure(outcome);
    expect(ttlValuesHolding(user.id)).toBe(heldBefore);
  });

  test("誤ったコード 4 回の後に正しいコードで options を取ると、共有の試行枠が戻り、続く MFA の無効化の誤り 5 回はどれもロックにならない", async () => {
    const { user, secret } = await createMfaEnabledUser("budget-reset");
    const session = signedInSession(user);
    for (let attempt = 0; attempt < 4; attempt++) {
      await requestRegistrationOptionsWith(session, { totp_code: await wrongCode(secret) });
    }
    challengeOf(
      await requestRegistrationOptionsWith(session, { totp_code: await currentCode(secret) }),
    );

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await sendMfaDisable(session, await wrongCode(secret))).status);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400]);
  });

  test("コードを載せない options は試行枠を使わず、5 回の後も MFA の無効化の誤り 5 回はどれもロックにならない", async () => {
    const { user, secret } = await createMfaEnabledUser("no-code-budget");
    const session = signedInSession(user);
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(statusAndBody(await requestRegistrationOptionsWith(session, {}))).toEqual({
        status: 403,
        body: { _tag: "TotpRequired" },
      });
    }

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      statuses.push((await sendMfaDisable(session, await wrongCode(secret))).status);
    }

    expect(statuses).toEqual([400, 400, 400, 400, 400]);
  });

  test("MFA の状態の読みは有効で、照合の時には無効になっていた時は、MFA が無効である既知の失敗になり challenge を置かない", async () => {
    const user = await createUser("disabled-meanwhile");
    const heldBefore = ttlValuesHolding(user.id);
    const session = signedInSession(user, {
      layer: Layer.succeed(
        MfaTotpRepo,
        partial<MfaTotpRepo["Service"]>({
          readMfaStatusRow: () =>
            Effect.succeed({ verifiedAt: new Date(), unusedRecoveryCodes: 8 }),
          findMfaTotp: () => Effect.succeed(undefined),
        }),
      ),
    });

    const outcome = await requestRegistrationOptionsWith(session, { totp_code: "123456" });

    expect(statusAndBody(outcome)).toEqual({ status: 409, body: { _tag: "NotEnabled" } });
    expect(ttlValuesHolding(user.id)).toBe(heldBefore);
  });

  test("TTL store で試行の回数を数えられない時は、正しいコードを載せた options も既知の失敗になり、challenge を置かない", async () => {
    const { user, secret } = await createMfaEnabledUser("uncountable");
    const heldBefore = ttlValuesHolding(user.id);

    const outcome = await requestRegistrationOptionsWith(
      signedInSession(user, { layer: ttlStoreWithoutCounting }),
      { totp_code: await currentCode(secret) },
    );

    expectKnownClientFailure(outcome);
    expect(ttlValuesHolding(user.id)).toBe(heldBefore);
  });
});
