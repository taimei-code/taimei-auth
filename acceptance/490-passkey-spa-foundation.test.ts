import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { stoppingLintCodes } from "./harness/lint-probe";
import {
  type BrowserPart,
  createUser,
  creationFrom,
  declaredPasskeyFailureTags,
  failureTextOf,
  forgetScenario,
  installBrowser,
  openSession,
  optionsOf,
  readListedIds,
  registrationThroughSpa,
  rejectedAnswer,
  requestOptions,
  restoreBrowser,
  savedCredentialIdsOf,
  sendRegistration,
  supportJudgement,
  unexpectedFailureText,
} from "./harness/passkey-spa";

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const ONE_SECOND_MS = 1000;
const OPTIONS_REQUEST = "POST /api/account/passkeys/registration-options";
const REGISTER_REQUEST = "POST /api/account/passkeys";
const SIGNED_OUT_FAILURE = "Unauthorized";

afterEach(async () => {
  setSystemTime();
  restoreBrowser();
  await forgetScenario();
});

const serverOptionsFor = async (name: string) => {
  const owner = await createUser(name);
  const session = openSession(owner);
  return { owner, session, options: optionsOf(await requestOptions(session)) };
};

describe("登録の options から browser の作成の API を呼ぶ", () => {
  test("server の options を渡すと browser が作った JSON が返り、それを登録の API に送ると本人の credential が保存される", async () => {
    const { owner, session, options } = await serverOptionsFor("creator");
    const browser = installBrowser({ answer: "sign" });

    const outcome = await creationFrom(options);

    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect((await sendRegistration(session, outcome.json)).status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual(browser.answeredCredentialIds);
  });

  test("browser の作成の API には、server の options を parseCreationOptionsFromJSON で変換した値が渡る", async () => {
    const { options } = await serverOptionsFor("parser");
    const browser = installBrowser({ answer: "sign" });

    await creationFrom(options);

    expect(browser.parsedOptions).toEqual([options]);
    expect(browser.createdWith).toHaveLength(1);
    expect(browser.createdWith[0]).toBe(browser.parsedResults[0]);
  });
});

describe("browser がパスキーに対応しているかの判定", () => {
  const missingWebAuthn: readonly BrowserPart[] = ["PublicKeyCredential", "navigator.credentials"];
  for (const part of missingWebAuthn) {
    test(`${part} が無い browser では、対応していないと判定する`, async () => {
      installBrowser({ without: [part] });
      expect(await supportJudgement()).toBe(false);
    });
  }

  const missingJsonHelpers: readonly BrowserPart[] = [
    "parseCreationOptionsFromJSON",
    "parseRequestOptionsFromJSON",
    "toJSON",
  ];
  for (const part of missingJsonHelpers) {
    test(`WebAuthn の API はあるが ${part} が無い browser では、対応していないと判定する`, async () => {
      installBrowser({ without: [part] });
      expect(await supportJudgement()).toBe(false);
    });
  }

  test("WebAuthn の API と JSON の補助の API が揃った browser では、対応していると判定する", async () => {
    installBrowser();
    expect(await supportJudgement()).toBe(true);
  });
});

describe("dialog の取り消しと失敗", () => {
  test("browser が NotAllowedError で拒んだ時 (dialog の取り消し) は、失敗でなく取り消しとして返る", async () => {
    const { options } = await serverOptionsFor("canceller");
    installBrowser();

    expect(await creationFrom(options)).toEqual({ kind: "cancelled" });
  });

  for (const name of ["SecurityError", "UnknownError"]) {
    test(`browser が ${name} で拒んだ時は、取り消しでなく失敗として返る`, async () => {
      const { options } = await serverOptionsFor("failing");
      installBrowser({ answer: rejectedAnswer(name) });

      expect((await creationFrom(options)).kind).toBe("failed");
    });
  }
});

describe("画面の登録の口", () => {
  test("dialog を取り消すと結果は取り消しになり、登録の API に要求を送らず、本人の credential は増えない", async () => {
    const owner = await createUser("spa-canceller");
    const session = openSession(owner);
    installBrowser();

    const outcome = await registrationThroughSpa(session);

    expect(outcome.kind).toBe("cancelled");
    expect(outcome.requested).toEqual([OPTIONS_REQUEST]);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("browser が作った応答を送ると結果は登録の成功になり、一覧の API に 1 行出る", async () => {
    const owner = await createUser("spa-registrant");
    const session = openSession(owner);
    const browser = installBrowser({ answer: "sign" });

    const outcome = await registrationThroughSpa(session);

    expect(outcome.kind).toBe("registered");
    expect(outcome.requested).toEqual([OPTIONS_REQUEST, REGISTER_REQUEST]);
    expect(await readListedIds(session)).toHaveLength(1);
    expect(await savedCredentialIdsOf(owner)).toEqual(browser.answeredCredentialIds);
  });

  test("options を取ってから 5 分を 1 秒過ぎて応答を送ると失敗になり、想定外の失敗とは別の文言が出る", async () => {
    const owner = await createUser("spa-late");
    const session = openSession(owner);
    installBrowser({ answer: { signAfterMs: CHALLENGE_LIFETIME_MS + ONE_SECOND_MS } });

    const outcome = await registrationThroughSpa(session);

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.text).not.toBe("");
    expect(outcome.text).not.toBe(await unexpectedFailureText());
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });
});

describe("失敗の種類ごとの文言", () => {
  test("SPA の API 契約がパスキーの API に宣言する失敗の種類 (未ログインを除く) のそれぞれに、空でない文言がある", async () => {
    const tags = declaredPasskeyFailureTags().filter((tag) => tag !== SIGNED_OUT_FAILURE);
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const text = await failureTextOf(tag);
      expect({ tag, text: typeof text === "string" && text.length > 0 }).toEqual({ tag, text: true });
    }
  });
});

describe("browser の WebAuthn の API を呼べる file を絞る", () => {
  const probePath = "web/src/account/passkey-probe.ts";
  const probes = [
    {
      api: "PublicKeyCredential.parseCreationOptionsFromJSON",
      call: `import { Effect } from "effect";\nexport const probe = (json: PublicKeyCredentialCreationOptionsJSON) => Effect.sync(() => PublicKeyCredential.parseCreationOptionsFromJSON(json));`,
      withoutCall: `import { Effect } from "effect";\nexport const probe = (json: unknown) => Effect.sync(() => json);`,
    },
    {
      api: "navigator.credentials.create",
      call: `import { Effect } from "effect";\nexport const probe = (publicKey: PublicKeyCredentialCreationOptions) => Effect.tryPromise(() => navigator.credentials.create({ publicKey }));`,
      withoutCall: `import { Effect } from "effect";\nexport const probe = (publicKey: unknown) => Effect.tryPromise(() => Promise.resolve(publicKey));`,
    },
  ];
  for (const { api, call, withoutCall } of probes) {
    test(`web/src の別の file で ${api} を呼ぶと lint が止め、呼び出しを除いた同じ形の file は止めない`, () => {
      expect(stoppingLintCodes(probePath, withoutCall)).toEqual([]);
      expect(stoppingLintCodes(probePath, call)).not.toEqual([]);
    });
  }
});
