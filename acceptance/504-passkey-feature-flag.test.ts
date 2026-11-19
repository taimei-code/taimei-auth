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
  type FlagRules,
  flagsWith,
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

const released: FlagRules = { enabled: true, listedCompanies: [], everyone: true };

const listedIn = (companies: string[]): FlagRules => ({
  enabled: true,
  listedCompanies: companies,
  everyone: false,
});

const disabled: FlagRules = { enabled: false, listedCompanies: [], everyone: true };

const listedOnly = (companies: string[]): Flag =>
  flagsWith({ registration: listedIn(companies), signIn: released });

const bothReleased = (): Flag => flagsWith({ registration: released, signIn: released });

const bothDisabled = (): Flag => flagsWith({ registration: disabled, signIn: disabled });

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

    flag.registration = { ...flag.registration, listedCompanies: [] };
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
    const flag = flagsWith({ registration: released, signIn: disabled });
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
  test("ログインの flag を無効にすると、ログインの options は、未保存の credential の失敗と同じ状態と本文になる", async () => {
    const enabledFailure = await unsavedCredentialFailure(listedOnly([]));
    const signInDisabled = flagsWith({ registration: released, signIn: disabled });

    const outcome = await requestSignInOptions(await anonymousAppUnder(signInDisabled));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
  });

  test("options を取った後でログインの flag を無効にすると、保存したパスキーの検証は未保存の credential の失敗と同じになり、session cookie は出ない", async () => {
    const enabledFailure = await unsavedCredentialFailure(listedOnly([]));
    const flag = bothReleased();
    const member = await createMember("signing-in", null);
    const credential = await savedCredentialOf(member);
    const app = await anonymousAppUnder(flag);
    const challenge = challengeOf(await requestSignInOptions(app));

    flag.signIn = { ...flag.signIn, enabled: false };
    const outcome = await sendSignIn(app, assertionBy(credential, challenge));

    expect(statusAndBody(outcome)).toEqual(enabledFailure);
    expect(sessionCookiesOf(outcome)).toEqual([]);
  });

  test("全体公開とリストのルールが当たる user でも、登録の flag を無効にすると登録の options はリストに無い user と同じ失敗になる", async () => {
    const listed = await createCompany("listed");
    const flag = flagsWith({
      registration: { enabled: true, listedCompanies: [listed], everyone: true },
      signIn: released,
    });
    const refusal = await registrationRefusal(listedOnly([listed]));
    const member = await createMember("listed-member", listed);

    flag.registration = { ...flag.registration, enabled: false };
    const outcome = await requestRegistrationOptions(await signedInUnder(flag, member));

    expect(statusAndBody(outcome)).toEqual(refusal);
  });

  test("両方の flag を無効にしても一覧と削除は使え、無効にする前にパスキーで発行した session は引ける", async () => {
    const flag = bothReleased();
    const member = await createMember("kept-session", null);
    const credential = await savedCredentialOf(member);
    await savedCredentialOf(member);
    const app = await anonymousAppUnder(flag);
    const signedIn = await sendSignIn(
      app,
      assertionBy(credential, challengeOf(await requestSignInOptions(app))),
    );

    flag.registration = { ...flag.registration, enabled: false };
    flag.signIn = { ...flag.signIn, enabled: false };
    const session = await signedInUnder(flag, member);
    const listed = await listOf(session);
    const deleted = await deletePasskey(session, listed.passkeyIds[0] ?? "");

    expect(listed.status).toBe(200);
    expect(listed.passkeyIds).toHaveLength(2);
    expect(deleted).toBe(200);
    expect(await sessionUserOf(signedIn)).toBe(member.id);
  });
});

describe("登録とログインの flag は独立している", () => {
  test("登録の flag だけを無効にしてもログインでき、ログインの flag だけを無効にしても登録できる", async () => {
    const listed = await createCompany("listed");
    const signer = await createMember("signer", null);
    const credential = await savedCredentialOf(signer);
    const registrant = await createMember("registrant", listed);
    const registrationOff = flagsWith({ registration: disabled, signIn: released });
    const signInOff = flagsWith({ registration: listedIn([listed]), signIn: disabled });

    const app = await anonymousAppUnder(registrationOff);
    const signedIn = await sendSignIn(
      app,
      assertionBy(credential, challengeOf(await requestSignInOptions(app))),
    );
    const registered = await registerThroughOptions(await signedInUnder(signInOff, registrant));

    expect(signedIn.status).toBe(200);
    expect(await sessionUserOf(signedIn)).toBe(signer.id);
    expect(registered.status).toBe(200);
    expect(await savedPasskeyCountOf(registrant)).toBe(1);
  });
});

describe("flag を評価できない", () => {
  for (const trouble of ["binding-fails", "flag-missing"] as const) {
    test(`${trouble === "binding-fails" ? "binding の呼び出しが失敗する" : "flag が無い"}時は、ログインの options、登録の options、共通ログイン画面のパスキーの入口が、無効の時と同じになる`, async () => {
      const listed = await createCompany("listed");
      const member = await createMember("unevaluated", listed);
      const allDisabled = bothDisabled();
      const troubled: Flag = {
        registration: { enabled: true, listedCompanies: [listed], everyone: true },
        signIn: released,
        trouble,
      };
      const observe = async (flag: Flag) => ({
        signIn: statusAndBody(await requestSignInOptions(await anonymousAppUnder(flag))),
        registration: statusAndBody(
          await requestRegistrationOptions(await signedInUnder(flag, member)),
        ),
        entry: await signInEntryShown(await anonymousAppUnder(flag)),
      });

      const whenDisabled = await observe(allDisabled);
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

  test("session を持たずに、共通ログイン画面のパスキーの入口を出すかを受け取れる (ログインの flag が全体公開なら出し、事業所のリストだけか無効なら出さない)", async () => {
    const listed = await createCompany("listed");
    const shownUnder = async (signIn: FlagRules) =>
      signInEntryShown(
        await anonymousAppUnder(flagsWith({ registration: listedIn([listed]), signIn })),
      );

    const shown = [
      await shownUnder(released),
      await shownUnder(listedIn([listed])),
      await shownUnder(disabled),
    ];

    expect(shown).toEqual([true, false, false]);
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
