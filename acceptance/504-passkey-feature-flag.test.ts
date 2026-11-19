import { afterEach, describe, expect, test } from "bun:test";
import {
  anonymousAppUnder,
  assertionBy,
  challengeOf,
  challengesIssuedTo,
  createCompany,
  createMember,
  deletePasskey,
  type Flag,
  flagWith,
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
  switchCurrentCompany,
  unsavedCredential,
} from "./harness/passkey-feature-flag";
import { adrFiles, readRepoText } from "./harness/repo-text";

afterEach(forgetFlagScenario);

const statusAndBody = (outcome: { status: number; body: unknown }) => ({
  status: outcome.status,
  body: outcome.body,
});

const listedOnly = (companies: string[]): Flag =>
  flagWith({ enabled: true, listedCompanies: companies, everyone: false });

const registrationRefusal = async (flag: Flag) => {
  const outsider = await createMember("outsider", await createCompany("unlisted"));
  return statusAndBody(await requestRegistrationOptions(await signedInUnder(flag, outsider)));
};

const unsavedCredentialFailure = async (flag: Flag) => {
  const app = await anonymousAppUnder(flag);
  const challenge = challengeOf(await requestSignInOptions(app));
  return statusAndBody(await sendSignIn(app, assertionBy(unsavedCredential(), challenge)));
};

describe("事業所のリストで登録を公開する", () => {
  test("現在の事業所がリストにある user は、options を取って登録でき、パスキーが 1 本増える", async () => {
    const listed = await createCompany("listed");
    const member = await createMember("listed-member", listed);
    const session = await signedInUnder(listedOnly([listed]), member);

    const outcome = await registerThroughOptions(session);

    expect(outcome.status).toBe(200);
    expect(await savedPasskeyCountOf(member)).toBe(1);
  });

  test("現在の事業所がリストに無い user の登録の options は 403 になり、challenge を置かない", async () => {
    const listed = await createCompany("listed");
    const outsider = await createMember("outsider", await createCompany("unlisted"));
    const session = await signedInUnder(listedOnly([listed]), outsider);

    const outcome = await requestRegistrationOptions(session);

    expect(outcome.status).toBe(403);
    expect(challengesIssuedTo(outsider)).toBe(0);
  });

  test("options を取った後で事業所をリストから外すと、送った登録はリストに無い user と同じ失敗になり、パスキーは増えない", async () => {
    const listed = await createCompany("listed");
    const flag = listedOnly([listed]);
    const member = await createMember("removed-later", listed);
    const session = await signedInUnder(flag, member);
    const options = await requestRegistrationOptions(session);
    const challenge = (options.body as { challenge: string }).challenge;

    flag.rules = { ...flag.rules, listedCompanies: [] };
    const outcome = await registerWith(session, challenge);

    expect(statusAndBody(outcome)).toEqual(await registrationRefusal(flag));
    expect(await savedPasskeyCountOf(member)).toBe(0);
  });

  test("現在の事業所が無い user の登録の options は、リストに無い user と同じ失敗になる", async () => {
    const flag = listedOnly([await createCompany("listed")]);
    const companyless = await createMember("companyless", null);

    const outcome = await requestRegistrationOptions(await signedInUnder(flag, companyless));

    expect(statusAndBody(outcome)).toEqual(await registrationRefusal(flag));
  });

  test("options の後で現在の事業所をリストに無い所属先へ切り替えて送った登録は、リストに無い user と同じ失敗になり、パスキーは増えない", async () => {
    const listed = await createCompany("listed");
    const unlisted = await createCompany("unlisted");
    const flag = listedOnly([listed]);
    const member = await createMember("switcher", listed, [unlisted]);
    const session = await signedInUnder(flag, member);
    const challenge = (
      (await requestRegistrationOptions(session)).body as { challenge: string }
    ).challenge;

    await switchCurrentCompany(member, unlisted);
    const outcome = await registerWith(session, challenge);

    expect(statusAndBody(outcome)).toEqual(await registrationRefusal(flag));
    expect(await savedPasskeyCountOf(member)).toBe(0);
  });
});

describe("全体公開", () => {
  test("全体公開が on なら、リストに無い事業所の user も現在の事業所が無い user も登録できる", async () => {
    const flag = flagWith({ enabled: true, listedCompanies: [], everyone: true });
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

describe("リストから外した事業所の user", () => {
  test("一覧で自分のパスキーを見られ、1 本を削除でき、残ったパスキーでログインできる", async () => {
    const flag = listedOnly([await createCompany("listed")]);
    const member = await createMember("delisted", await createCompany("delisted"));
    const kept = await savedCredentialOf(member);
    await savedCredentialOf(member);
    const session = await signedInUnder(flag, member);

    const listed = await listOf(session);
    const [removable] = listed.passkeyIds.slice(-1);
    const deleted = await deletePasskey(session, removable ?? "");
    const app = await anonymousAppUnder(flag);
    const challenge = challengeOf(await requestSignInOptions(app));
    const signedIn = await sendSignIn(app, assertionBy(kept, challenge));

    expect(listed.status).toBe(200);
    expect(listed.passkeyIds).toHaveLength(2);
    expect(deleted).toBe(200);
    expect((await listOf(session)).passkeyIds).toHaveLength(1);
    expect(signedIn.status).toBe(200);
    expect(await sessionUserOf(signedIn)).toBe(member.id);
  });
});

describe("flag を無効にする", () => {
  test("ログインの options は、未保存の credential の失敗と同じ状態と本文になる", async () => {
    const enabledFailure = await unsavedCredentialFailure(listedOnly([]));
    const disabled = flagWith({ enabled: false, listedCompanies: [], everyone: true });

    const outcome = await requestSignInOptions(await anonymousAppUnder(disabled));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
  });

  test("options を取った後で無効にすると、保存したパスキーの検証は未保存の credential の失敗と同じになり、session cookie は出ない", async () => {
    const enabledFailure = await unsavedCredentialFailure(listedOnly([]));
    const flag = flagWith({ enabled: true, listedCompanies: [], everyone: true });
    const member = await createMember("signing-in", null);
    const credential = await savedCredentialOf(member);
    const app = await anonymousAppUnder(flag);
    const challenge = challengeOf(await requestSignInOptions(app));

    flag.rules = { ...flag.rules, enabled: false };
    const outcome = await sendSignIn(app, assertionBy(credential, challenge));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
    expect(sessionCookiesOf(outcome)).toEqual([]);
  });

  test("全体公開とリストのルールが当たる user でも、無効にすると登録の options はリストに無い user と同じ失敗になる", async () => {
    const listed = await createCompany("listed");
    const flag = flagWith({ enabled: true, listedCompanies: [listed], everyone: true });
    const refusal = await registrationRefusal(listedOnly([listed]));
    const member = await createMember("listed-member", listed);

    flag.rules = { ...flag.rules, enabled: false };
    const outcome = await requestRegistrationOptions(await signedInUnder(flag, member));

    expect(statusAndBody(outcome)).toEqual(refusal);
  });

  test("無効にしても一覧と削除は使え、無効にする前にパスキーで発行した session は引ける", async () => {
    const flag = flagWith({ enabled: true, listedCompanies: [], everyone: true });
    const member = await createMember("kept-session", null);
    const credential = await savedCredentialOf(member);
    await savedCredentialOf(member);
    const app = await anonymousAppUnder(flag);
    const signedIn = await sendSignIn(
      app,
      assertionBy(credential, challengeOf(await requestSignInOptions(app))),
    );

    flag.rules = { ...flag.rules, enabled: false };
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
      const listed = await createCompany("listed");
      const member = await createMember("unevaluated", listed);
      const disabled = flagWith({ enabled: false, listedCompanies: [listed], everyone: true });
      const troubled: Flag = {
        rules: { enabled: true, listedCompanies: [listed], everyone: true },
        trouble,
      };
      const observe = async (flag: Flag) => ({
        signIn: statusAndBody(await requestSignInOptions(await anonymousAppUnder(flag))),
        registration: statusAndBody(
          await requestRegistrationOptions(await signedInUnder(flag, member)),
        ),
        entry: await signInEntryShown(await anonymousAppUnder(flag)),
      });

      const whenDisabled = await observe(disabled);
      const whenTroubled = await observe(troubled);

      expect(whenDisabled.entry).toBe(false);
      expect(whenTroubled).toEqual(whenDisabled);
    });
  }
});

describe("画面が受け取る判断", () => {
  test("一覧の応答から、行を出さない・一覧と削除だけ・登録もできる、を読み分けられる", async () => {
    const listed = await createCompany("listed");
    const unlisted = await createCompany("unlisted");
    const flag = listedOnly([listed]);
    const noneOutside = await createMember("none-outside", unlisted);
    const oneOutside = await createMember("one-outside", unlisted);
    await savedCredentialOf(oneOutside);
    const noneInside = await createMember("none-inside", listed);
    const oneInside = await createMember("one-inside", listed);
    await savedCredentialOf(oneInside);

    const views = await Promise.all(
      [noneOutside, oneOutside, noneInside, oneInside].map(
        async (member) => (await listOf(await signedInUnder(flag, member))).view,
      ),
    );

    expect(views).toEqual(["no-row", "list-and-delete-only", "can-register", "can-register"]);
  });

  test("session を持たずに、共通ログイン画面のパスキーの入口を出すかを受け取れる (有効なら出す、無効なら出さない)", async () => {
    const enabled = flagWith({ enabled: true, listedCompanies: [], everyone: false });
    const disabled = flagWith({ enabled: false, listedCompanies: [], everyone: true });

    const shown = [
      await signInEntryShown(await anonymousAppUnder(enabled)),
      await signInEntryShown(await anonymousAppUnder(disabled)),
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
