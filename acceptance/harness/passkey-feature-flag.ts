import { Effect, Layer } from "effect";
import type { Hono } from "hono";
import { dbTest } from "../../src/__tests__/live-runner";
import { TestDb } from "../../src/__tests__/test-db";
import { buildAppWith } from "../../src/handlers/__tests__/helpers";
import { authLayer, sessionOf } from "../../src/membership/__tests__/test-layers";
import { switchCurrentCompany as switchTo } from "../../src/membership/current-company";
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

const PASSKEY_FLAG_KEY = "passkey";
const LIST_PATH = "/api/account/passkeys";
const SIGN_IN_ENTRY_PATH = "/api/passkey/sign-in/availability";
const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

const { run, cleanup } = dbTest("acc-504-");

export const forgetFlagScenario = async (): Promise<void> => {
  await forgetScenario();
  await cleanup();
};

export type FlagRules = {
  readonly enabled: boolean;
  readonly listedCompanies: readonly string[];
  readonly everyone: boolean;
};

type FlagTrouble = "none" | "binding-fails" | "flag-missing";

export type Flag = {
  rules: FlagRules;
  trouble: FlagTrouble;
};

export const flagWith = (rules: FlagRules): Flag => ({ rules, trouble: "none" });

type Details = {
  readonly flagKey: string;
  readonly value: boolean;
  readonly reason: string;
  readonly errorCode?: string;
};

const FLAGSHIP_ENTRIES: readonly unknown[] = ["account", "login"];

const ruleMatches = (rules: FlagRules, context: Record<string, unknown>): boolean =>
  rules.listedCompanies.some((companyId) => companyId === context.companyId) ||
  context.entry === "login" ||
  (rules.everyone && FLAGSHIP_ENTRIES.includes(context.entry));

const evaluate = (
  flag: Flag,
  flagKey: string,
  defaultValue: boolean,
  context: Record<string, unknown>,
): Details => {
  if (flag.trouble === "binding-fails") throw new Error("flagship is unavailable");
  if (flagKey !== PASSKEY_FLAG_KEY || flag.trouble === "flag-missing") {
    return { flagKey, value: defaultValue, reason: "ERROR", errorCode: "FLAG_NOT_FOUND" };
  }
  if (!flag.rules.enabled) return { flagKey, value: false, reason: "DISABLED" };
  return ruleMatches(flag.rules, context)
    ? { flagKey, value: true, reason: "TARGETING_MATCH" }
    : { flagKey, value: false, reason: "DEFAULT" };
};

const flagshipBindingOf = (flag: Flag) => {
  const details = async (
    flagKey: string,
    defaultValue: boolean,
    context: Record<string, unknown> = {},
  ): Promise<Details> => evaluate(flag, flagKey, defaultValue, context);
  return {
    getBooleanDetails: details,
    getBooleanValue: async (
      flagKey: string,
      defaultValue: boolean,
      context: Record<string, unknown> = {},
    ) => (await details(flagKey, defaultValue, context)).value,
    get: async (flagKey: string, defaultValue?: unknown, context: Record<string, unknown> = {}) =>
      (await details(flagKey, defaultValue === true, context)).value,
  };
};

const flagLayerOf = async (flag: Flag) => {
  const { FEATURE_FLAGS_BINDING, flagshipFeatureFlags } = await import("../../src/feature-flags");
  return flagshipFeatureFlags({ [FEATURE_FLAGS_BINDING]: flagshipBindingOf(flag) } as never);
};

export const anonymousAppUnder = async (flag: Flag): Promise<Hono> =>
  buildAppWith(await flagLayerOf(flag));

export type Member = { readonly id: string; readonly email: string };

const uniqueSuffix = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`;

export const createCompany = (name: string): Promise<string> =>
  run(TestDb.use((testDb) => testDb.seedCompany(uniqueSuffix(name))));

export const createMember = (
  name: string,
  current: string | null,
  otherCompanies: readonly string[] = [],
): Promise<Member> =>
  run(
    Effect.gen(function* () {
      const testDb = yield* TestDb;
      const seeded = yield* testDb.seedUser(uniqueSuffix(name), { lastUsedCompanyId: current });
      for (const companyId of [...(current === null ? [] : [current]), ...otherCompanies]) {
        yield* testDb.seedMembership(seeded.id, companyId);
      }
      return { id: seeded.id, email: seeded.email };
    }),
  );

export const switchCurrentCompany = async (member: Member, companyId: string): Promise<void> => {
  await run(switchTo({ userId: member.id, companyId }));
};

export const signedInUnder = async (flag: Flag, member: Member): Promise<Session> => ({
  user: member,
  app: buildAppWith(Layer.merge(authLayer(() => sessionOf(member.id)), await flagLayerOf(flag))),
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
