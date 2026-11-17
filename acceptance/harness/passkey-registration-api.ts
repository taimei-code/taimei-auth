import { Effect, Layer } from "effect";
import type { Hono } from "hono";
import { dbTest } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import { testKvStore, testTtlStore } from "../../src/__tests__/test-ttl-store";
import { buildAppWith } from "../../src/handlers/__tests__/helpers";
import { signedIn, signedOut } from "../../src/membership/__tests__/test-layers";
import { enableMfaFor } from "../../src/mfa/__tests__/helpers";
import { ttlStoreLayer } from "../../src/ttl-store-service";
import type { TtlKey } from "../../src/ttl-key";
import { signedRegistration } from "./passkey-registration";
import { passkeysOf, passkeyToSave, savePasskey } from "./passkey-storage";

const OPTIONS_PATH = "/api/account/passkeys/registration-options";
const REGISTER_PATH = "/api/account/passkeys";
const LIST_PATH = "/api/account/passkeys";
const EXISTING_SIGNED_IN_POST_PATH = "/api/account/mfa/enroll";
const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

const { run, cleanup } = dbTest("acc-489-");

const keysBefore = new Set<string>(testKvStore.keys(""));

export type User = { readonly id: string; readonly email: string };

export const createUser = (name: string): Promise<User> =>
  run(TestDb.use((testDb) => testDb.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`)));

export const createMfaEnabledUser = (name: string): Promise<User> =>
  run(
    Effect.gen(function* () {
      const user = yield* (yield* TestDb).seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`);
      yield* enableMfaFor(user);
      return user;
    }),
  );

export const forgetScenario = async (): Promise<void> => {
  for (const key of testKvStore.keys("")) {
    if (!keysBefore.has(key)) testKvStore.delete(key as TtlKey);
  }
  await cleanup();
};

type TtlStoreTrouble = "none" | "uncountable" | "challenge-unreadable";

export type Session = { readonly user: User; readonly app: Hono; readonly cookie: string };

const layersFor = (user: User, trouble: TtlStoreTrouble) => {
  const identity = signedIn(user.id, user.email);
  if (trouble === "uncountable") {
    return Layer.merge(
      identity,
      ttlStoreLayer({
        ...testTtlStore,
        incrementRateWindow: () => Promise.reject(new Error("ttl store down")),
      }),
    );
  }
  if (trouble === "challenge-unreadable") {
    return Layer.merge(
      identity,
      ttlStoreLayer({
        ...testTtlStore,
        getAndDelete: () => Promise.reject(new Error("ttl store down")),
      }),
    );
  }
  return identity;
};

export const openSession = (
  user: User,
  { trouble = "none" as TtlStoreTrouble, cookie = undefined as string | undefined } = {},
): Session => ({
  user,
  app: buildAppWith(layersFor(user, trouble)),
  cookie: cookie ?? `${SESSION_COOKIE_NAME}=${crypto.randomUUID()}`,
});

export const sameSessionWithTrouble = (session: Session, trouble: TtlStoreTrouble): Session =>
  openSession(session.user, { trouble, cookie: session.cookie });

export type Outcome = {
  readonly status: number;
  readonly body: unknown;
  readonly setCookies: string[];
};

const outcomeOf = async (response: Response): Promise<Outcome> => ({
  status: response.status,
  body: await response.json().catch(() => null),
  setCookies: response.headers.getSetCookie(),
});

const post = (app: Hono, path: string, headers: Record<string, string>, body: string) =>
  app.request(path, { method: "POST", headers, body });

const sameOrigin = (session: Session) => ({
  ...JSON_HEADERS,
  cookie: session.cookie,
  "sec-fetch-site": "same-origin",
});

export type RegistrationOptions = {
  readonly challenge: string;
  readonly excludeCredentials: ReadonlyArray<{ readonly id: string }>;
};

export const requestOptions = async (session: Session): Promise<Outcome> =>
  outcomeOf(await post(session.app, OPTIONS_PATH, sameOrigin(session), "{}"));

export const optionsOf = (outcome: Outcome): RegistrationOptions => {
  if (outcome.status !== 200) throw new Error(`options が返らなかった: ${outcome.status}`);
  return outcome.body as RegistrationOptions;
};

export const sendRegistration = async (session: Session, response: unknown): Promise<Outcome> =>
  outcomeOf(await post(session.app, REGISTER_PATH, sameOrigin(session), JSON.stringify(response)));

export const readListedIds = async (session: Session): Promise<string[]> => {
  const response = await session.app.request(LIST_PATH, {
    headers: { ...JSON_HEADERS, cookie: session.cookie },
  });
  const body = (await response.json()) as { passkeys: Array<{ id: string }> };
  return body.passkeys.map(({ id }) => id);
};

export const savedCredentialIdsOf = async (user: User): Promise<string[]> =>
  (await passkeysOf(user.id)).map(({ credentialId }) => credentialId);

export const signedResponse = (
  challenge: string,
  overrides: { readonly userVerified?: boolean; readonly origin?: string } = {},
) =>
  signedRegistration({
    algorithm: "ES256",
    challenge,
    userVerified: overrides.userVerified ?? true,
    ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
  });

export const withChallengeReplacedBy = (
  response: ReturnType<typeof signedResponse>["response"],
  challenge: unknown,
) => {
  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
  return {
    ...response,
    response: {
      ...response.response,
      clientDataJSON: Buffer.from(JSON.stringify({ ...clientData, challenge })).toString(
        "base64url",
      ),
    },
  };
};

export const saveCredential = async (user: User, credentialId: string): Promise<void> => {
  const saved = await savePasskey(user.id, { ...passkeyToSave(), credentialId });
  if (!saved) throw new Error("パスキーを保存できなかった");
};

export const saveSomeCredential = async (user: User): Promise<string> => {
  const material = passkeyToSave();
  await saveCredential(user, material.credentialId);
  return material.credentialId;
};

export const ttlValuesHolding = (value: string): number =>
  testKvStore.keys("").filter((key) => testKvStore.get(key as TtlKey) === value).length;

export const requestOptionsWithoutSession = async (): Promise<Outcome> =>
  outcomeOf(await post(buildAppWith(signedOut()), OPTIONS_PATH, JSON_HEADERS, "{}"));

export const sendRegistrationWithoutSession = async (response: unknown): Promise<Outcome> =>
  outcomeOf(
    await post(buildAppWith(signedOut()), REGISTER_PATH, JSON_HEADERS, JSON.stringify(response)),
  );

export const postExistingSignedInApiWithoutSession = async (): Promise<Outcome> =>
  outcomeOf(
    await post(buildAppWith(signedOut()), EXISTING_SIGNED_IN_POST_PATH, JSON_HEADERS, "{}"),
  );

const crossSite = (session: Session) => ({
  cookie: session.cookie,
  "sec-fetch-site": "cross-site",
  "content-type": "application/x-www-form-urlencoded",
});

export const crossSiteStatuses = async (session: Session) => ({
  options: (await post(session.app, OPTIONS_PATH, crossSite(session), "")).status,
  register: (await post(session.app, REGISTER_PATH, crossSite(session), "")).status,
  existing: (await post(session.app, EXISTING_SIGNED_IN_POST_PATH, crossSite(session), "")).status,
});

export const startMfaEnrollment = async (session: Session): Promise<Outcome> =>
  outcomeOf(await post(session.app, EXISTING_SIGNED_IN_POST_PATH, sameOrigin(session), "{}"));
