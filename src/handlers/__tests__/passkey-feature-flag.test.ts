import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { Hono } from "hono";
import { fakeFlagship } from "../../../testing/feature-flags";
import { dbTest } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { ttlValuesHolding } from "../../__tests__/test-ttl-store";
import { authLayer, sessionOf } from "../../membership/__tests__/test-layers";
import { passkeysOf } from "../../passkey/__tests__/helpers";
import { JSON_HEADERS } from "../client-facing-error";
import {
  assertionBy,
  buildAppWith,
  challengeOf,
  type Outcome,
  postJson,
  requestRegistrationOptions,
  requestSignInOptions,
  restoreKvStoreAfterEach,
  sameOriginHeaders,
  savedCredentialFor,
  sendRegistration,
  sendSignIn,
  type SignedInSession,
  sessionCookiesOf,
  sessionUserOf,
  signedRegistrationFor,
  statusAndBody,
  unsavedCredential,
} from "./helpers";

type FakeFlagship = ReturnType<typeof fakeFlagship>;
type Member = { readonly id: string; readonly email: string };

const PASSKEY = "passkey";
const LIST_PATH = "/api/account/passkeys";
const SIGN_IN_ENTRY_PATH = "/api/passkey/sign-in/availability";

const flagshipWith = async (
  setUp: (flags: FakeFlagship) => Promise<void>,
): Promise<FakeFlagship> => {
  const flags = fakeFlagship();
  await setUp(flags);
  return flags;
};

const released = () => flagshipWith((flags) => flags.on(PASSKEY));

const disabled = () => flagshipWith((flags) => flags.off(PASSKEY));

const listedOnly = (companies: string[]) =>
  flagshipWith((flags) => flags.onlyFor(PASSKEY, companies));

type RegistrationView = "no-row" | "list-and-delete-only" | "can-register";

describe("パスキーの登録とログインを、フィーチャーフラグで開け閉めする", () => {
  const { run, cleanup } = dbTest("passkey-feature-flag-test-");
  restoreKvStoreAfterEach();
  afterEach(cleanup);

  const uniqueSuffix = (name: string) => `${name}-${crypto.randomUUID().slice(0, 8)}`;

  const createCompany = (name: string): Promise<string> =>
    run(TestDb.use((db) => db.seedCompany(uniqueSuffix(name))));

  const createMember = (name: string, current: string | null): Promise<Member> =>
    run(
      Effect.gen(function* () {
        const db = yield* TestDb;
        const seeded = yield* db.seedUser(uniqueSuffix(name), { lastUsedCompanyId: current });
        if (current !== null) yield* db.seedMembership(seeded.id, current);
        return { id: seeded.id, email: seeded.email };
      }),
    );

  const signedInUnder = (flags: FakeFlagship, member: Member): SignedInSession => ({
    user: member,
    app: buildAppWith(
      Layer.merge(
        authLayer(() => sessionOf(member.id)),
        flags.layer,
      ),
    ),
    cookie: `__Secure-better-auth.session_token=${crypto.randomUUID()}`,
  });

  const anonymousAppUnder = (flags: FakeFlagship): Hono => buildAppWith(flags.layer);

  const registerWith = (session: SignedInSession, challenge: string): Promise<Outcome> =>
    sendRegistration(session, signedRegistrationFor(challenge).response);

  const registerThroughOptions = async (session: SignedInSession): Promise<Outcome> => {
    const options = await requestRegistrationOptions(session);
    if (options.status !== 200) return options;
    return registerWith(session, challengeOf(options));
  };

  const savedPasskeyCountOf = async (member: Member): Promise<number> =>
    (await run(passkeysOf(member.id))).length;

  const savedCredentialOf = (member: Member) => run(savedCredentialFor(member.id));

  const listOf = async (session: SignedInSession) => {
    const response = await session.app.request(LIST_PATH, {
      headers: { ...JSON_HEADERS, cookie: session.cookie },
    });
    if (response.status !== 200) {
      return { status: response.status, passkeyIds: [] as string[], view: null };
    }
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

  const deletePasskey = async (session: SignedInSession, passkeyId: string): Promise<number> =>
    (
      await postJson(
        session.app,
        `${LIST_PATH}/${passkeyId}/delete`,
        sameOriginHeaders(session.cookie),
        "{}",
      )
    ).status;

  const signInEntryShown = async (app: Hono): Promise<boolean | null> => {
    const response = await app.request(SIGN_IN_ENTRY_PATH, { headers: JSON_HEADERS });
    if (response.status !== 200) return null;
    const body = (await response.json()) as { available?: unknown };
    return typeof body.available === "boolean" ? body.available : null;
  };

  const registrationRefusal = async () => {
    const member = await createMember("refused", await createCompany("any"));
    return statusAndBody(await requestRegistrationOptions(signedInUnder(await disabled(), member)));
  };

  const unsavedCredentialFailure = async () => {
    const app = anonymousAppUnder(await released());
    const challenge = challengeOf(await requestSignInOptions(app));
    return statusAndBody(await sendSignIn(app, assertionBy(unsavedCredential(), challenge)));
  };

  test("全体公開なら、現在の事業所がある user も無い user も登録でき、パスキーが 1 本ずつ増える", async () => {
    const flag = await released();
    const member = await createMember("anywhere", await createCompany("any"));
    const companyless = await createMember("nowhere", null);

    const memberOutcome = await registerThroughOptions(signedInUnder(flag, member));
    const companylessOutcome = await registerThroughOptions(signedInUnder(flag, companyless));

    expect([memberOutcome.status, companylessOutcome.status]).toEqual([200, 200]);
    expect([await savedPasskeyCountOf(member), await savedPasskeyCountOf(companyless)]).toEqual([
      1, 1,
    ]);
  });

  test("全体公開のルールを残したまま無効にすると、登録の options は 403 になり、challenge を置かない", async () => {
    const member = await createMember("closed", await createCompany("any"));

    const outcome = await requestRegistrationOptions(signedInUnder(await disabled(), member));

    expect(outcome.status).toBe(403);
    expect(ttlValuesHolding(member.id)).toBe(0);
  });

  test("options を取った後で無効にすると、送った登録は無効の時の options と同じ失敗になり、パスキーは増えない", async () => {
    const refusal = await registrationRefusal();
    const flag = await released();
    const member = await createMember("disabled-later", await createCompany("any"));
    const session = signedInUnder(flag, member);
    const options = await requestRegistrationOptions(session);
    const challenge = (options.body as { challenge: string }).challenge;

    await flag.off(PASSKEY);
    const outcome = await registerWith(session, challenge);

    expect(statusAndBody(outcome)).toEqual(refusal);
    expect(await savedPasskeyCountOf(member)).toBe(0);
  });

  test("現在の事業所を事業所のリストに入れても、全体公開でなければ登録の options は無効の時と同じ失敗になり、ログイン画面の入口も出さない", async () => {
    const refusal = await registrationRefusal();
    const listed = await createCompany("listed");
    const flag = await listedOnly([listed]);
    const member = await createMember("listed-member", listed);

    const outcome = await requestRegistrationOptions(signedInUnder(flag, member));
    const entry = await signInEntryShown(anonymousAppUnder(flag));

    expect(statusAndBody(outcome)).toEqual(refusal);
    expect(entry).toBe(false);
  });

  test("無効にすると、ログインの options は、未保存の credential の失敗と同じ状態と本文になる", async () => {
    const enabledFailure = await unsavedCredentialFailure();

    const outcome = await requestSignInOptions(anonymousAppUnder(await disabled()));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
  });

  test("options を取った後で無効にすると、保存したパスキーの検証は未保存の credential の失敗と同じになり、session cookie は出ない", async () => {
    const enabledFailure = await unsavedCredentialFailure();
    const flag = await released();
    const member = await createMember("signing-in", null);
    const credential = await savedCredentialOf(member);
    const app = anonymousAppUnder(flag);
    const challenge = challengeOf(await requestSignInOptions(app));

    await flag.off(PASSKEY);
    const outcome = await sendSignIn(app, assertionBy(credential, challenge));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
    expect(sessionCookiesOf(outcome)).toEqual([]);
  });

  test("無効にしても一覧と削除は使え、無効にする前にパスキーで発行した session は引ける", async () => {
    const flag = await released();
    const member = await createMember("kept-session", null);
    const credential = await savedCredentialOf(member);
    await savedCredentialOf(member);
    const app = anonymousAppUnder(flag);
    const signedIn = await sendSignIn(
      app,
      assertionBy(credential, challengeOf(await requestSignInOptions(app))),
    );

    await flag.off(PASSKEY);
    const session = signedInUnder(flag, member);
    const listed = await listOf(session);
    const deleted = await deletePasskey(session, listed.passkeyIds[0] ?? "");

    expect(listed.status).toBe(200);
    expect(listed.passkeyIds).toHaveLength(2);
    expect(deleted).toBe(200);
    expect(await sessionUserOf(signedIn)).toBe(member.id);
  });

  for (const trouble of ["binding-fails", "flag-missing"] as const) {
    test(`${trouble === "binding-fails" ? "binding の呼び出しが失敗する" : "flag が無い"}時は、ログインの options、登録の options、共通ログイン画面のパスキーの入口が、無効の時と同じになる`, async () => {
      const member = await createMember("unevaluated", await createCompany("any"));
      const troubled = await flagshipWith(async (flags) => {
        await flags.on(PASSKEY);
        if (trouble === "binding-fails") flags.breakBinding();
        else flags.remove(PASSKEY);
      });
      const observe = async (flag: FakeFlagship) => ({
        signIn: statusAndBody(await requestSignInOptions(anonymousAppUnder(flag))),
        registration: statusAndBody(await requestRegistrationOptions(signedInUnder(flag, member))),
        entry: await signInEntryShown(anonymousAppUnder(flag)),
      });

      const whenDisabled = await observe(await disabled());
      const whenTroubled = await observe(troubled);

      expect(whenDisabled.entry).toBe(false);
      expect(whenTroubled).toEqual(whenDisabled);
    });
  }

  test("一覧の応答から、行を出さない・一覧と削除だけ・登録もできる、を読み分けられる", async () => {
    const none = await createMember("none", null);
    const one = await createMember("one", null);
    await savedCredentialOf(one);

    const viewsUnder = (flag: FakeFlagship) =>
      Promise.all(
        [none, one].map(async (member) => (await listOf(signedInUnder(flag, member))).view),
      );

    expect([
      ...(await viewsUnder(await disabled())),
      ...(await viewsUnder(await released())),
    ]).toEqual(["no-row", "list-and-delete-only", "can-register", "can-register"]);
  });

  test("session を持たずに、共通ログイン画面のパスキーの入口を出すかを受け取れる (全体公開なら出し、無効なら出さない)", async () => {
    const shown = [
      await signInEntryShown(anonymousAppUnder(await released())),
      await signInEntryShown(anonymousAppUnder(await disabled())),
    ];

    expect(shown).toEqual([true, false]);
  });
});
