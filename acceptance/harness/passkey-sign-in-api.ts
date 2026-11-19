import { Effect, Layer } from "effect";
import { Hono } from "hono";
import * as passkeyRepository from "../../db/repositories/passkey";
import { auth } from "../../src/auth";
import { CLIENT_IP_HEADER } from "../../src/client-ip";
import { auditRowsFor, dbTest } from "../../src/__tests__/live-runner";
import { TEST_CLIENT_IP, TEST_USER_AGENT } from "../../src/__tests__/session-helpers";
import { testTtlStore } from "../../src/__tests__/test-ttl-store";
import { buildAppWith } from "../../src/handlers/__tests__/helpers";
import { mountSpaApi } from "../../src/handlers/spa-http-api";
import { liftAll } from "../../src/errors";
import { PasskeyRepo } from "../../src/passkey/ports";
import { ttlStoreLayer } from "../../src/ttl-store-service";
import { signedAuthentication, signedRegistration, type Signer } from "./passkey-registration";
import type { User } from "./passkey-registration-api";
import { passkeysOf, savePasskey } from "./passkey-storage";

const OPTIONS_PATH = "/api/passkey/sign-in/options";
const VERIFY_PATH = "/api/passkey/sign-in/verify";
const LIST_PATH = "/api/account/passkeys";
const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const MFA_CHALLENGE_COOKIE_NAME = "__Host-mfa_login_challenge";
const REGISTRATION_CHALLENGE = "Y2hhbGxlbmdlLWZyb20tdGhlLXNpZ24taW4tc2V0dXA";

const { run } = dbTest("acc-500-");

export {
  createMfaEnabledUser,
  createUser,
  forgetScenario as forgetSignInScenario,
  type User,
} from "./passkey-registration-api";

export type Credential = { readonly credentialId: string; readonly signer: Signer };

export const savedCredentialOf = async (user: User, counter = 0): Promise<Credential> => {
  const { made, signer } = signedRegistration({
    algorithm: "ES256",
    challenge: REGISTRATION_CHALLENGE,
    userVerified: true,
  });
  const saved = await savePasskey(user.id, {
    credentialId: made.id,
    publicKey: made.publicKey,
    counter,
    aaguid: made.aaguid,
    transports: [],
  });
  if (!saved) throw new Error("パスキーを保存できなかった");
  return { credentialId: made.id, signer };
};

export const unsavedCredential = (): Credential => {
  const { made, signer } = signedRegistration({
    algorithm: "ES256",
    challenge: REGISTRATION_CHALLENGE,
    userVerified: true,
  });
  return { credentialId: made.id, signer };
};

export const forgetSavedCredential = async (user: User, credential: Credential): Promise<void> => {
  const { deletePasskey, findPasskeyByCredentialId } = await import(
    "../../db/repositories/passkey"
  );
  const row = await findPasskeyByCredentialId(credential.credentialId);
  if (row === undefined || (await deletePasskey(row.id, user.id)) === undefined) {
    throw new Error("パスキーを消せなかった");
  }
};

export const assertionBy = (
  credential: Credential,
  challenge: string,
  overrides: { readonly counter?: number; readonly userVerified?: boolean; readonly signer?: Signer } = {},
) =>
  signedAuthentication({
    credentialId: credential.credentialId,
    signer: overrides.signer ?? credential.signer,
    challenge,
    userVerified: overrides.userVerified ?? true,
    counter: overrides.counter ?? 1,
  });

export const liveApp = (): Hono => {
  const app = new Hono();
  mountSpaApi(app);
  return app;
};

export const uncountableApp = (): Hono =>
  buildAppWith(
    ttlStoreLayer({
      ...testTtlStore,
      incrementRateWindow: () => Promise.reject(new Error("ttl store down")),
    }),
  );

export const appLosingPasskeyBeforeRecordingUse = (user: User): Hono => {
  const live = liftAll(passkeyRepository);
  return buildAppWith(
    Layer.succeed(PasskeyRepo, {
      ...live,
      recordPasskeyUse: (id, counter) =>
        live.deletePasskey(id, user.id).pipe(Effect.andThen(live.recordPasskeyUse(id, counter))),
    }),
  );
};

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

const anonymousHeaders = {
  accept: "application/json",
  "content-type": "application/json",
  "sec-fetch-site": "same-origin",
  "user-agent": TEST_USER_AGENT,
  [CLIENT_IP_HEADER]: TEST_CLIENT_IP,
};

const post = async (app: Hono, path: string, body: unknown) =>
  outcomeOf(
    await app.request(path, { method: "POST", headers: anonymousHeaders, body: JSON.stringify(body) }),
  );

export const requestSignInOptions = (app: Hono, redirectUrl?: string): Promise<Outcome> =>
  post(app, OPTIONS_PATH, redirectUrl === undefined ? {} : { redirect_url: redirectUrl });

export const challengeOf = (outcome: Outcome): string => {
  if (outcome.status !== 200) throw new Error(`options が返らなかった: ${outcome.status}`);
  return (outcome.body as { challenge: string }).challenge;
};

export const sendSignIn = (app: Hono, response: unknown): Promise<Outcome> =>
  post(app, VERIFY_PATH, response);

export const signInWith = async (
  app: Hono,
  credential: Credential,
  redirectUrl: string,
  overrides: Parameters<typeof assertionBy>[2] = {},
): Promise<Outcome> => {
  const challenge = challengeOf(await requestSignInOptions(app, redirectUrl));
  return sendSignIn(app, assertionBy(credential, challenge, overrides));
};

const cookiesNamed = (setCookies: readonly string[], name: string) =>
  setCookies.filter((cookie) => cookie.startsWith(`${name}=`));

export const sessionCookiesOf = (outcome: { readonly setCookies: readonly string[] }) =>
  cookiesNamed(outcome.setCookies, SESSION_COOKIE_NAME);

export const mfaChallengeCookiesOf = (outcome: Outcome) =>
  cookiesNamed(outcome.setCookies, MFA_CHALLENGE_COOKIE_NAME);

const cookieHeaderOf = (setCookie: string) => setCookie.split(";", 1)[0] ?? "";

export const sessionUserOf = async (outcome: Outcome): Promise<string | null> => {
  const [setCookie] = sessionCookiesOf(outcome);
  if (setCookie === undefined) return null;
  const session = await auth.api.getSession({
    headers: new Headers({ cookie: cookieHeaderOf(setCookie) }),
  });
  return session?.user.id ?? null;
};

export type CookieShape = {
  readonly tokenLength: number;
  readonly signatureLength: number;
  readonly percentEncoded: boolean;
  readonly attributes: readonly string[];
};

export const cookieShapeOf = (setCookie: string): CookieShape => {
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

export const signInAuditsOf = async (user: User): Promise<unknown[]> =>
  (await run(auditRowsFor(user.id, "sign_in"))).map((row) => row.payload);

export type ListedPasskey = { readonly credentialId: string; readonly lastUsedAt: string | null };

export const listedWith = async (outcome: Outcome, user: User): Promise<ListedPasskey[]> => {
  const [setCookie] = sessionCookiesOf(outcome);
  if (setCookie === undefined) throw new Error("session cookie が無い");
  const response = await liveApp().request(LIST_PATH, {
    headers: { ...anonymousHeaders, cookie: cookieHeaderOf(setCookie) },
  });
  const body = (await response.json()) as {
    passkeys: Array<{ id: string; last_used_at: string | null }>;
  };
  const { listPasskeys } = await import("../../db/repositories/passkey");
  const credentialIdOf = new Map((await listPasskeys(user.id)).map((row) => [row.id, row.credentialId]));
  return body.passkeys.map((listed) => ({
    credentialId: credentialIdOf.get(listed.id) ?? "",
    lastUsedAt: listed.last_used_at,
  }));
};

export const storedLastUsedOf = async (user: User): Promise<Map<string, Date | null>> =>
  new Map((await passkeysOf(user.id)).map((row) => [row.credentialId, row.lastUsedAt]));

type RegisteredPlugin = {
  readonly id: string;
  readonly hooks?: { readonly after?: ReadonlyArray<{ matcher: (ctx: { path: string }) => boolean }> };
};

export const betterAuthRoutePaths = (): string[] =>
  Object.values(auth.api as unknown as Record<string, { path?: string }>)
    .map((endpoint) => endpoint?.path)
    .filter((path): path is string => typeof path === "string")
    .toSorted();

export const routesCreatingMfaChallenge = (): string[] => {
  const plugins = (auth.options.plugins ?? []) as unknown as RegisteredPlugin[];
  const matcher = plugins.find((plugin) => plugin.id === "primary-auth")?.hooks?.after?.[0]?.matcher;
  if (matcher === undefined) throw new Error("一次認証の after-hook が無い");
  return betterAuthRoutePaths().filter((path) => matcher({ path }));
};
