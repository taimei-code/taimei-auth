import { Effect, Layer } from "effect";
import type { Hono } from "hono";
import { dbTest } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import { buildAppWith } from "../../src/handlers/__tests__/helpers";
import { authLayer, sessionOf } from "../../src/membership/__tests__/test-layers";
import type { FakeFlagship } from "./feature-flags";
import {
  forgetScenario,
  type Outcome,
  requestOptions,
  type Session,
  sendRegistration,
  signedResponse,
  ttlValuesHolding,
} from "./passkey-registration-api";
import { passkeysOf } from "./passkey-storage";

export {
  assertionBy,
  challengeOf,
  requestSignInOptions,
  savedCredentialOf,
  sendSignIn,
  sessionCookiesOf,
  sessionUserOf,
  unsavedCredential,
} from "./passkey-sign-in-api";
export type { Outcome, Session } from "./passkey-registration-api";

const LIST_PATH = "/api/account/passkeys";
const SIGN_IN_ENTRY_PATH = "/api/passkey/sign-in/availability";
const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

const { run, cleanup } = dbTest("acc-504-");

export const forgetFlagScenario = async (): Promise<void> => {
  await forgetScenario();
  await cleanup();
};

export const anonymousAppUnder = async (flags: FakeFlagship): Promise<Hono> =>
  buildAppWith(await flags.layer());

export type Member = { readonly id: string; readonly email: string };

const uniqueSuffix = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`;

export const createCompany = (name: string): Promise<string> =>
  run(TestDb.use((testDb) => testDb.seedCompany(uniqueSuffix(name))));

export const createMember = (name: string, current: string | null): Promise<Member> =>
  run(
    Effect.gen(function* () {
      const testDb = yield* TestDb;
      const seeded = yield* testDb.seedUser(uniqueSuffix(name), { lastUsedCompanyId: current });
      if (current !== null) yield* testDb.seedMembership(seeded.id, current);
      return { id: seeded.id, email: seeded.email };
    }),
  );

export const signedInUnder = async (flags: FakeFlagship, member: Member): Promise<Session> => ({
  user: member,
  app: buildAppWith(Layer.merge(authLayer(() => sessionOf(member.id)), await flags.layer())),
  cookie: `${SESSION_COOKIE_NAME}=${crypto.randomUUID()}`,
});

export const requestRegistrationOptions = (session: Session): Promise<Outcome> =>
  requestOptions(session);

export const registerWith = (session: Session, challenge: string): Promise<Outcome> =>
  sendRegistration(session, signedResponse(challenge).response);

export const registerThroughOptions = async (session: Session): Promise<Outcome> => {
  const options = await requestRegistrationOptions(session);
  if (options.status !== 200) return options;
  return registerWith(session, (options.body as { challenge: string }).challenge);
};

export const savedPasskeyCountOf = async (member: Member): Promise<number> =>
  (await passkeysOf(member.id)).length;

export const challengesIssuedTo = (member: Member): number => ttlValuesHolding(member.id);

export type RegistrationView = "no-row" | "list-and-delete-only" | "can-register";

export type Listed = {
  readonly status: number;
  readonly passkeyIds: readonly string[];
  readonly view: RegistrationView | null;
};

export const listOf = async (session: Session): Promise<Listed> => {
  const response = await session.app.request(LIST_PATH, {
    headers: { ...JSON_HEADERS, cookie: session.cookie },
  });
  if (response.status !== 200) return { status: response.status, passkeyIds: [], view: null };
  const body = (await response.json()) as {
    passkeys: Array<{ id: string }>;
    can_register?: unknown;
  };
  const passkeyIds = body.passkeys.map(({ id }) => id);
  const view: RegistrationView | null =
    typeof body.can_register !== "boolean"
      ? null
      : body.can_register
        ? "can-register"
        : passkeyIds.length === 0
          ? "no-row"
          : "list-and-delete-only";
  return { status: response.status, passkeyIds, view };
};

export const deletePasskey = async (session: Session, passkeyId: string): Promise<number> =>
  (
    await session.app.request(`${LIST_PATH}/${passkeyId}/delete`, {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: session.cookie, "sec-fetch-site": "same-origin" },
      body: "{}",
    })
  ).status;

export const signInEntryShown = async (app: Hono): Promise<boolean | null> => {
  const response = await app.request(SIGN_IN_ENTRY_PATH, { headers: JSON_HEADERS });
  if (response.status !== 200) return null;
  const body = (await response.json()) as { available?: unknown };
  return typeof body.available === "boolean" ? body.available : null;
};
