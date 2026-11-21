import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect, Layer } from "effect";
import { auditRowsFor, dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { ttlStoreWithoutCounting } from "../../__tests__/test-ttl-store";
import {
  cleanupIssuedChallenges,
  enableMfaFor,
  issueTestChallenge,
  totpCode,
} from "../../mfa/__tests__/helpers";
import { passkeysOf } from "../../passkey/__tests__/helpers";
import { PasskeyRepo } from "../../passkey/ports";
import { PasskeyRepoLive } from "../../passkey/wiring";
import { JSON_HEADERS } from "../client-facing-error";
import {
  assertionBy,
  buildAppWith,
  challengeOf,
  type Credential,
  liveApp,
  type Outcome,
  outcomeOf,
  requestRegistrationOptions,
  requestSignInOptions,
  restoreKvStoreAfterEach,
  savedCredentialFor,
  sendRegistration,
  sendSignIn,
  sessionCookiesOf,
  sessionUserOf,
  signedInSession,
  signedRegistrationFor,
  statusAndBody,
  unsavedCredential,
} from "./helpers";

const TRUSTED_REDIRECT = "/account/security";
const UNTRUSTED_REDIRECT = "https://evil.example.net/steal";
const DEFAULT_REDIRECT = "/account";
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const ONE_SECOND_MS = 1000;
const ATTEMPTS_PER_MINUTE = 10;
const RATE_LIMITED = { status: 429, body: { _tag: "RateLimited" } };
const MFA_CHALLENGE_COOKIE_NAME = "__Host-mfa_login_challenge";

const expectKnownClientFailure = (outcome: Outcome) => {
  expect(outcome.status).toBeGreaterThanOrEqual(400);
  expect(outcome.status).toBeLessThan(500);
  expect(typeof (outcome.body as { _tag?: unknown } | null)?._tag).toBe("string");
  expect(sessionCookiesOf(outcome)).toEqual([]);
};

type CookieShape = {
  readonly tokenLength: number;
  readonly signatureLength: number;
  readonly percentEncoded: boolean;
  readonly attributes: readonly string[];
};

const cookieShapeOf = (setCookie: string): CookieShape => {
  const [pair = "", ...attributes] = setCookie.split(";").map((part) => part.trim());
  const value = pair.slice(pair.indexOf("=") + 1);
  const decoded = decodeURIComponent(value);
  const separator = decoded.lastIndexOf(".");
  return {
    tokenLength: separator,
    signatureLength: decoded.length - separator - 1,
    percentEncoded: value === encodeURIComponent(decoded),
    attributes: attributes
      .map((attribute) => {
        const [name = "", ...rest] = attribute.split("=");
        return [name.toLowerCase(), ...rest].join("=");
      })
      .toSorted(),
  };
};

describe("パスキーのログイン", () => {
  const { run, cleanup } = dbTest("passkey-sign-in-test-");
  restoreKvStoreAfterEach();
  afterEach(async () => {
    setSystemTime();
    await run(cleanupIssuedChallenges());
    await cleanup();
  });

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

  const savedCredentialOf = (user: { readonly id: string }, counter = 0): Promise<Credential> =>
    run(savedCredentialFor(user.id, counter));

  const forgetSavedCredential = (user: { readonly id: string }, credential: Credential) =>
    run(
      PasskeyRepo.use((repo) =>
        repo.findPasskeyByCredentialId(credential.credentialId).pipe(
          Effect.flatMap((row) => repo.deletePasskey(row?.id ?? "", user.id)),
          Effect.flatMap((deleted) =>
            deleted === undefined ? Effect.die(new Error("パスキーを消せなかった")) : Effect.void,
          ),
        ),
      ),
    );

  const appLosingPasskeyBeforeRecordingUse = (user: { readonly id: string }) =>
    buildAppWith(
      Layer.effect(
        PasskeyRepo,
        Effect.map(PasskeyRepo, (live) =>
          PasskeyRepo.of({
            ...live,
            recordPasskeyUse: (id, counter) =>
              live
                .deletePasskey(id, user.id)
                .pipe(Effect.andThen(live.recordPasskeyUse(id, counter))),
          }),
        ),
      ).pipe(Layer.provide(PasskeyRepoLive)),
    );

  const signInWith = async (
    app: ReturnType<typeof liveApp>,
    credential: Credential,
    redirectUrl: string,
    overrides: Parameters<typeof assertionBy>[2] = {},
  ): Promise<Outcome> => {
    const challenge = challengeOf(await requestSignInOptions(app, redirectUrl));
    return sendSignIn(app, assertionBy(credential, challenge, overrides));
  };

  const signInAuditsOf = async (user: { readonly id: string }): Promise<unknown[]> =>
    (await run(auditRowsFor(user.id, "sign_in"))).map((row) => row.payload);

  const sessionCookieOfMfaChallengePass = () =>
    run(
      Effect.gen(function* () {
        const user = yield* TestDb.use((db) => db.seedUser("pass"));
        const enabled = yield* enableMfaFor(user);
        const challenge = yield* issueTestChallenge({
          userId: user.id,
          redirectUrl: TRUSTED_REDIRECT,
          method: "magic_link",
        });
        const code = yield* totpCode(enabled.secret);
        return yield* Effect.promise(async () =>
          outcomeOf(
            await liveApp().request("/api/mfa/challenge/verify", {
              method: "POST",
              headers: {
                ...Object.fromEntries(challenge.headers),
                "content-type": "application/json",
              },
              body: JSON.stringify({ code, kind: "totp" }),
            }),
          ),
        );
      }),
    );

  const listedWith = async (outcome: Outcome, user: { readonly id: string }) => {
    const [setCookie] = sessionCookiesOf(outcome);
    if (setCookie === undefined) throw new Error("session cookie が無い");
    const response = await liveApp().request("/api/account/passkeys", {
      headers: { ...JSON_HEADERS, cookie: setCookie.split(";", 1)[0] ?? "" },
    });
    const body = (await response.json()) as {
      passkeys: Array<{ id: string; last_used_at: string | null }>;
    };
    const rows = await run(PasskeyRepo.use((repo) => repo.listPasskeys(user.id)));
    const credentialIdOf = new Map(rows.map((row) => [row.id, row.credentialId]));
    return body.passkeys.map((listed) => ({
      credentialId: credentialIdOf.get(listed.id) ?? "",
      lastUsedAt: listed.last_used_at,
    }));
  };

  const uncountableApp = () => buildAppWith(ttlStoreWithoutCounting);

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
    const viaChallenge = await sessionCookieOfMfaChallengePass();

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
    expect(
      outcome.setCookies.filter((cookie) => cookie.startsWith(`${MFA_CHALLENGE_COOKIE_NAME}=`)),
    ).toEqual([]);
    expect(await sessionUserOf(outcome)).toBe(user.id);
  });

  test("ログインに成功すると、その user のログインの記録が方法 passkey で 1 件だけ増える", async () => {
    const user = await createUser("audit");
    const credential = await savedCredentialOf(user);
    const before = await signInAuditsOf(user);

    await signInWith(liveApp(), credential, TRUSTED_REDIRECT);

    const after = await signInAuditsOf(user);
    expect(after).toHaveLength(before.length + 1);
    expect(
      after.filter((payload) => (payload as { method?: unknown }).method === "passkey"),
    ).toHaveLength(1);
  });

  test("options に信頼していない origin の遷移先を渡してログインすると、遷移先は /account になる", async () => {
    const user = await createUser("redirect");
    const credential = await savedCredentialOf(user);

    const outcome = await signInWith(liveApp(), credential, UNTRUSTED_REDIRECT);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ redirect_url: DEFAULT_REDIRECT });
  });

  test("ログインに成功した応答をもう一度送ると既知の失敗になり、session cookie は発行されない", async () => {
    const user = await createUser("replay");
    const credential = await savedCredentialOf(user);
    const app = liveApp();
    const challenge = challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT));
    const response = assertionBy(credential, challenge, { counter: 1 });

    expect((await sendSignIn(app, response)).status).toBe(200);
    expectKnownClientFailure(
      await sendSignIn(app, assertionBy(credential, challenge, { counter: 2 })),
    );
  });

  test("options の発行から 5 分の 1 秒前に送った応答は通り、5 分の 1 秒後に送った応答は既知の失敗になる", async () => {
    const user = await createUser("expiry");
    const credential = await savedCredentialOf(user);
    const app = liveApp();

    const issuedEarly = Date.now();
    const early = challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT));
    setSystemTime(new Date(issuedEarly + CHALLENGE_LIFETIME_MS - ONE_SECOND_MS));
    expect((await sendSignIn(app, assertionBy(credential, early, { counter: 1 }))).status).toBe(
      200,
    );

    setSystemTime();
    const issuedLate = Date.now();
    const late = challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT));
    setSystemTime(new Date(issuedLate + CHALLENGE_LIFETIME_MS + ONE_SECOND_MS));
    expectKnownClientFailure(await sendSignIn(app, assertionBy(credential, late, { counter: 2 })));
  });

  test("パスキーの登録の options が返した challenge で署名した認証の応答は、ログインの検証で既知の失敗になる", async () => {
    const user = await createUser("cross-sign-in");
    const credential = await savedCredentialOf(user);
    const registrationChallenge = challengeOf(
      await requestRegistrationOptions(signedInSession(user)),
    );

    expectKnownClientFailure(
      await sendSignIn(liveApp(), assertionBy(credential, registrationChallenge)),
    );
  });

  test("ログインの options が返した challenge で署名した登録の応答は、登録の API で既知の失敗になり、パスキーは増えない", async () => {
    const user = await createUser("cross-register");
    const signInChallenge = challengeOf(await requestSignInOptions(liveApp(), TRUSTED_REDIRECT));

    const outcome = await sendRegistration(
      signedInSession(user),
      signedRegistrationFor(signInChallenge).response,
    );

    expect(outcome.status).toBeGreaterThanOrEqual(400);
    expect(outcome.status).toBeLessThan(500);
    expect(await run(passkeysOf(user.id))).toEqual([]);
  });

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
        assertionBy(target, challengeOf(await requestSignInOptions(app, TRUSTED_REDIRECT)), {
          counter,
        }),
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

  test("応答の検証を通った後、使った事実を記録する前にパスキーが消えると、ログインは既知の失敗になり session cookie は発行されない", async () => {
    const user = await createUser("vanished");
    const credential = await savedCredentialOf(user);

    const outcome = await signInWith(
      appLosingPasskeyBeforeRecordingUse(user),
      credential,
      TRUSTED_REDIRECT,
    );

    expectKnownClientFailure(outcome);
  });

  test("ログインすると、一覧で使ったパスキーの最後に使った日時がログインの前後の間になり、使っていないパスキーは変わらない", async () => {
    const user = await createUser("last-used");
    const used = await savedCredentialOf(user);
    const unused = await savedCredentialOf(user);
    const storedLastUsed = async () =>
      new Map((await run(passkeysOf(user.id))).map((row) => [row.credentialId, row.lastUsedAt]));
    const unusedBefore = (await storedLastUsed()).get(unused.credentialId);

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

  test("同じ IP から 1 分の間に、options は 10 回目まで通って 11 回目が既存の API と同じ失敗になり、10 回の後でも検証の 1 回目は止まらない", async () => {
    const app = liveApp();
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MINUTE; attempt++) {
      expect((await requestSignInOptions(app, TRUSTED_REDIRECT)).status).toBe(200);
    }

    expect(statusAndBody(await requestSignInOptions(app, TRUSTED_REDIRECT))).toEqual(RATE_LIMITED);
    expect(
      (await sendSignIn(app, assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"))).status,
    ).not.toBe(RATE_LIMITED.status);
  });

  test("同じ IP から 1 分の間に、検証は 10 回目まで試行枠で止まらず、11 回目が既存の API と同じ失敗になる", async () => {
    const app = liveApp();
    const attempt = () =>
      sendSignIn(app, assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"));
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
    const verified = await sendSignIn(
      app,
      assertionBy(unsavedCredential(), "c2lnbi1pbi1jaGFsbGVuZ2U"),
    );
    expect(verified.status).not.toBe(RATE_LIMITED.status);
    expectKnownClientFailure(verified);
  });
});
