import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { cleanupMfaChallengeFixtures, passMfaChallenge } from "./harness/mfa-challenge-pass";
import {
  forgetScenario,
  openSession,
  optionsOf,
  requestOptions,
  savedCredentialIdsOf,
  sendRegistration,
  signedResponse,
} from "./harness/passkey-registration-api";
import {
  appLosingPasskeyBeforeRecordingUse,
  assertionBy,
  challengeOf,
  cookieShapeOf,
  createMfaEnabledUser,
  createUser,
  forgetSavedCredential,
  forgetSignInScenario,
  listedWith,
  liveApp,
  mfaChallengeCookiesOf,
  type Outcome,
  requestSignInOptions,
  savedCredentialOf,
  sendSignIn,
  sessionCookiesOf,
  sessionUserOf,
  signInAuditsOf,
  signInWith,
  storedLastUsedOf,
  uncountableApp,
  unsavedCredential,
} from "./harness/passkey-sign-in-api";

const TRUSTED_REDIRECT = "/account/security";
const UNTRUSTED_REDIRECT = "https://evil.example.net/steal";
const DEFAULT_REDIRECT = "/account";
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const ONE_SECOND_MS = 1000;
const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };

const expectKnownClientFailure = (outcome: Outcome) => {
  expect(outcome.status).toBeGreaterThanOrEqual(400);
  expect(outcome.status).toBeLessThan(500);
  expect(typeof (outcome.body as { _tag?: unknown } | null)?._tag).toBe("string");
  expect(sessionCookiesOf(outcome)).toEqual([]);
};

const statusAndBody = (outcome: Outcome) => ({ status: outcome.status, body: outcome.body });

afterEach(async () => {
  setSystemTime();
  await forgetSignInScenario();
});

describe("パスキーのログイン", () => {
  test("MFA を有効にしていない user が保存したパスキーで、session を持たずに options の challenge に署名した応答を送ると、options に渡した遷移先が返り、その user の session cookie が発行される", async () => {
    const user = await createUser("plain");
    const credential = await savedCredentialOf(user);

    const outcome = await signInWith(liveApp(), credential, TRUSTED_REDIRECT);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ redirect_url: TRUSTED_REDIRECT });
    expect(sessionCookiesOf(outcome)).toHaveLength(1);
    expect(await sessionUserOf(outcome)).toBe(user.id);
  });

  test("パスキーのログインの session cookie は、MFA チャレンジの通過の session cookie と値の形式と属性が同じ", async () => {
    const user = await createUser("shape");
    const credential = await savedCredentialOf(user);
    const viaPasskey = await signInWith(liveApp(), credential, TRUSTED_REDIRECT);
    const viaChallenge = await passMfaChallenge({ redirectUrl: TRUSTED_REDIRECT, method: "magic_link" });
    await cleanupMfaChallengeFixtures();

    const [passkeyCookie] = sessionCookiesOf(viaPasskey);
    const [challengeCookie] = sessionCookiesOf(viaChallenge);
    expect(passkeyCookie).toBeDefined();
    expect(challengeCookie).toBeDefined();
    expect(cookieShapeOf(passkeyCookie ?? "")).toEqual(cookieShapeOf(challengeCookie ?? ""));
  });

  test("MFA を有効にした user がパスキーでログインすると、MFA チャレンジの cookie は発行されず、その user の session と options に渡した遷移先が返る", async () => {
    const user = await createMfaEnabledUser("mfa");
    const credential = await savedCredentialOf(user);

    const outcome = await signInWith(liveApp(), credential, TRUSTED_REDIRECT);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ redirect_url: TRUSTED_REDIRECT });
    expect(mfaChallengeCookiesOf(outcome)).toEqual([]);
    expect(await sessionUserOf(outcome)).toBe(user.id);
  });

  test("ログインに成功すると、その user のログインの記録が方法 passkey で 1 件だけ増える", async () => {
    const user = await createUser("audit");
    const credential = await savedCredentialOf(user);
    const before = await signInAuditsOf(user);

    await signInWith(liveApp(), credential, TRUSTED_REDIRECT);

    const after = await signInAuditsOf(user);
    expect(after).toHaveLength(before.length + 1);
    expect(after.filter((payload) => (payload as { method?: unknown }).method === "passkey")).toHaveLength(1);
  });

  test("options に信頼していない origin の遷移先を渡してログインすると、遷移先は /account になる", async () => {
    const user = await createUser("redirect");
    const credential = await savedCredentialOf(user);

    const outcome = await signInWith(liveApp(), credential, UNTRUSTED_REDIRECT);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ redirect_url: DEFAULT_REDIRECT });
  });
});

describe("ログインの challenge", () => {
  test("ログインに成功した応答をもう一度送ると既知の失敗になり、session cookie は発行されない", async () => {
    const user = await createUser("replay");
    const credential = await savedCredentialOf(user);
    const app = liveApp();
    const challenge = challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT));
    const response = assertionBy(credential, challenge, { counter: 1 });

    expect((await sendSignIn(app, response)).status).toBe(200);
    expectKnownClientFailure(await sendSignIn(app, assertionBy(credential, challenge, { counter: 2 })));
  });

  test("options の発行から 5 分の 1 秒前に送った応答は通り、5 分の 1 秒後に送った応答は既知の失敗になる", async () => {
    const user = await createUser("expiry");
    const credential = await savedCredentialOf(user);
    const app = liveApp();

    const issuedEarly = Date.now();
    const early = challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT));
    setSystemTime(new Date(issuedEarly + CHALLENGE_LIFETIME_MS - ONE_SECOND_MS));
    expect((await sendSignIn(app, assertionBy(credential, early, { counter: 1 }))).status).toBe(200);

    setSystemTime();
    const issuedLate = Date.now();
    const late = challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT));
    setSystemTime(new Date(issuedLate + CHALLENGE_LIFETIME_MS + ONE_SECOND_MS));
    expectKnownClientFailure(await sendSignIn(app, assertionBy(credential, late, { counter: 2 })));
  });

  test("パスキーの登録の options が返した challenge で署名した認証の応答は、ログインの検証で既知の失敗になる", async () => {
    const user = await createUser("cross-sign-in");
    const credential = await savedCredentialOf(user);
    const registrationChallenge = optionsOf(await requestOptions(openSession(user))).challenge;

    expectKnownClientFailure(await sendSignIn(liveApp(), assertionBy(credential, registrationChallenge)));
    await forgetScenario();
  });

  test("ログインの options が返した challenge で署名した登録の応答は、登録の API で既知の失敗になり、パスキーは増えない", async () => {
    const user = await createUser("cross-register");
    const signInChallenge = challengeOf(await requestSignInOptions(liveApp(), TRUSTED_REDIRECT));

    const outcome = await sendRegistration(openSession(user), signedResponse(signInChallenge).response);

    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(outcome.status).toBeLessThan(500);
    expect(await savedCredentialIdsOf(user)).toEqual([]);
    await forgetScenario();
  });
});

describe("ログインの失敗", () => {
  test("未保存の credential、削除したパスキー、生体か PIN の確認が無い応答、保存した別のパスキーの鍵で署名した応答は、どれも session cookie を発行せず、同じ状態と本文の既知の失敗になる", async () => {
    const user = await createUser("failures");
    const app = liveApp();
    const kept = await savedCredentialOf(user);
    const other = await savedCredentialOf(user);
    const forgotten = await savedCredentialOf(user);
    await forgetSavedCredential(user, forgotten);
    const signInOf = async (build: (challenge: string) => unknown) =>
      sendSignIn(app, build(challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT))));

    const outcomes = [
      await signInOf((challenge) => assertionBy(unsavedCredential(), challenge)),
      await signInOf((challenge) => assertionBy(forgotten, challenge)),
      await signInOf((challenge) => assertionBy(kept, challenge, { userVerified: false })),
      await signInOf((challenge) => assertionBy(kept, challenge, { signer: other.signer })),
    ];

    for (const outcome of outcomes) expectKnownClientFailure(outcome);
    expect(new Set(outcomes.map((outcome) => JSON.stringify(statusAndBody(outcome)))).size).toBe(1);
  });

  test("counter を 5 で保存したパスキーで、counter が 5 と 4 の応答は未保存の credential と同じ失敗になり、6 の応答は通る", async () => {
    const user = await createUser("counter");
    const credential = await savedCredentialOf(user, 5);
    const app = liveApp();
    const signInAt = async (counter: number, target = credential) =>
      sendSignIn(
        app,
        assertionBy(target, challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT)), { counter }),
      );

    const unsaved = statusAndBody(await signInAt(1, unsavedCredential()));
    const same = await signInAt(5);
    const lower = await signInAt(4);

    expectKnownClientFailure(same);
    expectKnownClientFailure(lower);
    expect(statusAndBody(same)).toEqual(unsaved);
    expect(statusAndBody(lower)).toEqual(unsaved);
    expect((await signInAt(6)).status).toBe(200);
  });
});

describe("検証と記録の間に消えたパスキー", () => {
  test("応答の検証を通った後、使った事実を記録する前にパスキーが消えると、ログインは既知の失敗になり session cookie は発行されない", async () => {
    const user = await createUser("vanished");
    const credential = await savedCredentialOf(user);

    const outcome = await signInWith(appLosingPasskeyBeforeRecordingUse(user), credential, TRUSTED_REDIRECT);

    expectKnownClientFailure(outcome);
  });
});

describe("ログインと最後に使った日時", () => {
  test("ログインすると、一覧で使ったパスキーの最後に使った日時がログインの前後の間になり、使っていないパスキーは変わらない", async () => {
    const user = await createUser("last-used");
    const used = await savedCredentialOf(user);
    const unused = await savedCredentialOf(user);
    const unusedBefore = (await storedLastUsedOf(user)).get(unused.credentialId);

    const before = Date.now();
    const outcome = await signInWith(liveApp(), used, TRUSTED_REDIRECT);
    const after = Date.now();

    const listed = await listedWith(outcome, user);
    const usedListed = listed.find(({ credentialId }) => credentialId === used.credentialId);
    const unusedListed = listed.find(({ credentialId }) => credentialId === unused.credentialId);
    const usedAt = new Date(usedListed?.lastUsedAt ?? Number.NaN).getTime();
    expect(usedAt).toBeGreaterThanOrEqual(before);
    expect(usedAt).toBeLessThanOrEqual(after);
    expect(unusedListed?.lastUsedAt ?? null).toBe(unusedBefore?.toISOString() ?? null);
  });
});

describe("ログインの試行枠", () => {
  test("同じ IP から 1 分の間に、options は 10 回目まで通って 11 回目が既存の API と同じ失敗になり、10 回の後でも検証の 1 回目は止まらない", async () => {
    const app = liveApp();
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MINUTE; attempt++) {
      expect((await requestSignInOptions(app, TRUSTED_REDIRECT)).status).toBe(200);
    }

    expect(statusAndBody(await requestSignInOptions(app, TRUSTED_REDIRECT))).toEqual(RATE_LIMITED);
    expect((await sendSignIn(app, assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"))).status).not.toBe(
      RATE_LIMITED.status,
    );
  });

  test("同じ IP から 1 分の間に、検証は 10 回目まで試行枠で止まらず、11 回目が既存の API と同じ失敗になる", async () => {
    const app = liveApp();
    const attempt = () => sendSignIn(app, assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"));
    for (let count = 1; count <= ATTEMPTS_PER_MINUTE; count++) {
      expect((await attempt()).status).not.toBe(RATE_LIMITED.status);
    }

    expect(statusAndBody(await attempt())).toEqual(RATE_LIMITED);
  });

  test("TTL store で回数を数えられない時、同じ IP からの 11 回目の options と検証は試行枠で止まらない", async () => {
    const app = uncountableApp();
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MINUTE; attempt++) {
      await requestSignInOptions(app, TRUSTED_REDIRECT);
      await sendSignIn(app, assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"));
    }

    expect((await requestSignInOptions(app, TRUSTED_REDIRECT)).status).toBe(200);
    const verified = await sendSignIn(app, assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"));
    expect(verified.status).not.toBe(RATE_LIMITED.status);
    expectKnownClientFailure(verified);
  });
});
