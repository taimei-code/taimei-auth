import { afterEach, describe, expect, test } from "bun:test";
import {
  anonymousAppUnder,
  assertionBy,
  challengeOf,
  challengesIssuedTo,
  createCompany,
  createMember,
  deletePasskey,
  forgetFlagScenario,
  listOf,
  registerThroughOptions,
  registerWith,
  requestRegistrationOptions,
  requestSignInOptions,
  savedCredentialOf,
  savedPasskeyCountOf,
  sendSignIn,
  sessionCookiesOf,
  sessionUserOf,
  signedInUnder,
  signInEntryShown,
  unsavedCredential,
} from "./harness/passkey-feature-flag";
import { type FakeFlagship, fakeFlagship } from "./harness/feature-flags";
import { adrFiles, readRepoText } from "./harness/repo-text";

afterEach(forgetFlagScenario);

const statusAndBody = (outcome: { status: number; body: unknown }) => ({
  status: outcome.status,
  body: outcome.body,
});

const PASSKEY = "passkey";

const flagshipWith = (setUp: (flags: FakeFlagship) => void): FakeFlagship => {
  const flags = fakeFlagship();
  setUp(flags);
  return flags;
};

const released = () => flagshipWith((flags) => flags.on(PASSKEY));

const disabled = () => flagshipWith((flags) => flags.off(PASSKEY));

const listedOnly = (companies: string[]) =>
  flagshipWith((flags) => flags.onlyFor(PASSKEY, companies));

const registrationRefusal = async () => {
  const member = await createMember("refused", await createCompany("any"));
  return statusAndBody(await requestRegistrationOptions(await signedInUnder(disabled(), member)));
};

const unsavedCredentialFailure = async () => {
  const app = await anonymousAppUnder(released());
  const challenge = challengeOf(await requestSignInOptions(app));
  return statusAndBody(await sendSignIn(app, assertionBy(unsavedCredential(), challenge)));
};

describe("全体公開で登録を開く", () => {
  test("全体公開なら、現在の事業所がある user も無い user も登録でき、パスキーが 1 本ずつ増える", async () => {
    const flag = released();
    const member = await createMember("anywhere", await createCompany("any"));
    const companyless = await createMember("nowhere", null);

    const memberOutcome = await registerThroughOptions(await signedInUnder(flag, member));
    const companylessOutcome = await registerThroughOptions(await signedInUnder(flag, companyless));

    expect([memberOutcome.status, companylessOutcome.status]).toEqual([200, 200]);
    expect([await savedPasskeyCountOf(member), await savedPasskeyCountOf(companyless)]).toEqual([
      1, 1,
    ]);
  });
});

describe("登録を閉じる", () => {
  test("全体公開のルールを残したまま無効にすると、登録の options は 403 になり、challenge を置かない", async () => {
    const member = await createMember("closed", await createCompany("any"));

    const outcome = await requestRegistrationOptions(await signedInUnder(disabled(), member));

    expect(outcome.status).toBe(403);
    expect(challengesIssuedTo(member)).toBe(0);
  });

  test("options を取った後で無効にすると、送った登録は無効の時の options と同じ失敗になり、パスキーは増えない", async () => {
    const refusal = await registrationRefusal();
    const flag = released();
    const member = await createMember("disabled-later", await createCompany("any"));
    const session = await signedInUnder(flag, member);
    const options = await requestRegistrationOptions(session);
    const challenge = (options.body as { challenge: string }).challenge;

    flag.off(PASSKEY);
    const outcome = await registerWith(session, challenge);

    expect(statusAndBody(outcome)).toEqual(refusal);
    expect(await savedPasskeyCountOf(member)).toBe(0);
  });

  test("現在の事業所を事業所のリストに入れても、全体公開でなければ登録の options は無効の時と同じ失敗になり、ログイン画面の入口も出さない", async () => {
    const refusal = await registrationRefusal();
    const listed = await createCompany("listed");
    const flag = listedOnly([listed]);
    const member = await createMember("listed-member", listed);

    const outcome = await requestRegistrationOptions(await signedInUnder(flag, member));
    const entry = await signInEntryShown(await anonymousAppUnder(flag));

    expect(statusAndBody(outcome)).toEqual(refusal);
    expect(entry).toBe(false);
  });
});

describe("ログインを閉じる", () => {
  test("無効にすると、ログインの options は、未保存の credential の失敗と同じ状態と本文になる", async () => {
    const enabledFailure = await unsavedCredentialFailure();

    const outcome = await requestSignInOptions(await anonymousAppUnder(disabled()));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
  });

  test("options を取った後で無効にすると、保存したパスキーの検証は未保存の credential の失敗と同じになり、session cookie は出ない", async () => {
    const enabledFailure = await unsavedCredentialFailure();
    const flag = released();
    const member = await createMember("signing-in", null);
    const credential = await savedCredentialOf(member);
    const app = await anonymousAppUnder(flag);
    const challenge = challengeOf(await requestSignInOptions(app));

    flag.off(PASSKEY);
    const outcome = await sendSignIn(app, assertionBy(credential, challenge));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
    expect(sessionCookiesOf(outcome)).toEqual([]);
  });
});

describe("無効にしても残るもの", () => {
  test("無効にしても一覧と削除は使え、無効にする前にパスキーで発行した session は引ける", async () => {
    const flag = released();
    const member = await createMember("kept-session", null);
    const credential = await savedCredentialOf(member);
    await savedCredentialOf(member);
    const app = await anonymousAppUnder(flag);
    const signedIn = await sendSignIn(
      app,
      assertionBy(credential, challengeOf(await requestSignInOptions(app))),
    );

    flag.off(PASSKEY);
    const session = await signedInUnder(flag, member);
    const listed = await listOf(session);
    const deleted = await deletePasskey(session, listed.passkeyIds[0] ?? "");

    expect(listed.status).toBe(200);
    expect(listed.passkeyIds).toHaveLength(2);
    expect(deleted).toBe(200);
    expect(await sessionUserOf(signedIn)).toBe(member.id);
  });
});

describe("flag を評価できない", () => {
  for (const trouble of ["binding-fails", "flag-missing"] as const) {
    test(`${trouble === "binding-fails" ? "binding の呼び出しが失敗する" : "flag が無い"}時は、ログインの options、登録の options、共通ログイン画面のパスキーの入口が、無効の時と同じになる`, async () => {
      const member = await createMember("unevaluated", await createCompany("any"));
      const troubled =
        trouble === "binding-fails"
          ? flagshipWith((flags) => {
              flags.on(PASSKEY);
              flags.breakBinding();
            })
          : fakeFlagship();
      const observe = async (flag: FakeFlagship) => ({
        signIn: statusAndBody(await requestSignInOptions(await anonymousAppUnder(flag))),
        registration: statusAndBody(
          await requestRegistrationOptions(await signedInUnder(flag, member)),
        ),
        entry: await signInEntryShown(await anonymousAppUnder(flag)),
      });

      const whenDisabled = await observe(disabled());
      const whenTroubled = await observe(troubled);

      expect(whenDisabled.entry).toBe(false);
      expect(whenTroubled).toEqual(whenDisabled);
    });
  }
});

describe("画面が受け取る判断", () => {
  test("一覧の応答から、行を出さない・一覧と削除だけ・登録もできる、を読み分けられる", async () => {
    const none = await createMember("none", null);
    const one = await createMember("one", null);
    await savedCredentialOf(one);

    const viewsUnder = (flag: FakeFlagship) =>
      Promise.all(
        [none, one].map(async (member) => (await listOf(await signedInUnder(flag, member))).view),
      );

    expect([...(await viewsUnder(disabled())), ...(await viewsUnder(released()))]).toEqual([
      "no-row",
      "list-and-delete-only",
      "can-register",
      "can-register",
    ]);
  });

  test("session を持たずに、共通ログイン画面のパスキーの入口を出すかを受け取れる (全体公開なら出し、無効なら出さない)", async () => {
    const shown = [
      await signInEntryShown(await anonymousAppUnder(released())),
      await signInEntryShown(await anonymousAppUnder(disabled())),
    ];

    expect(shown).toEqual([true, false]);
  });
});

describe("運用の文書", () => {
  test("docs/adr に Flagship を題にした ADR があり、Workers Free と GA の見直しに触れる", () => {
    const flagshipAdrs = adrFiles()
      .map(readRepoText)
      .filter((text) => /^# .*Flagship/m.test(text));

    expect(flagshipAdrs).toHaveLength(1);
    expect(flagshipAdrs[0]).toContain("Workers Free");
    expect(flagshipAdrs[0]).toContain("GA");
  });

  test("本番と staging の runbook に、フィーチャーフラグの見出しがある", () => {
    const headed = ["docs/runbook/production.md", "docs/runbook/staging.md"].map((path) =>
      /^#+ .*フィーチャーフラグ/m.test(readRepoText(path)),
    );

    expect(headed).toEqual([true, true]);
  });
});
