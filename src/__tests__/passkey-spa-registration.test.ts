import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { Effect } from "effect";
import { SpaHttpClient } from "../../web/src/shared/spa-http-client";
import { createPasskey } from "../../web/src/passkey/webauthn";
import {
  PASSKEY_FAILURE_MESSAGES,
  passkeyFailureText,
} from "../../web/src/passkey/passkey-failure-messages";
import { registerPasskey } from "../../web/src/passkey/passkey-registration";
import {
  type SignedInSession,
  requestRegistrationOptions,
  restoreKvStoreAfterEach,
  sendRegistration,
  signedInSession,
  signedRegistrationFor,
  listedPasskeyIds,
} from "../handlers/__tests__/helpers";
import type { RegistrationOptions } from "../passkey/passkey-contract";
import { passkeysOf } from "../passkey/__tests__/helpers";
import { spaEndpointTable } from "../spa-contract-table";
import { dbTest } from "./live-runner";
import { TestDb } from "./test-db";

const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
const ONE_SECOND_MS = 1000;
const OPTIONS_REQUEST = "POST /api/account/passkeys/registration-options";
const REGISTER_REQUEST = "POST /api/account/passkeys";

type Answer = (publicKey: { readonly parsedFrom: RegistrationOptions }) => Promise<unknown>;

const cancelledAnswer: Answer = () =>
  Promise.reject(
    new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"),
  );

const originalCredentials = Object.getOwnPropertyDescriptor(globalThis.navigator, "credentials");
const originalFetch = globalThis.fetch;

const installBrowser = (answer: Answer | "sign" | { readonly signAfterMs: number }) => {
  const answeredCredentialIds: string[] = [];
  const sign: Answer = ({ parsedFrom }) => {
    const signed = signedRegistrationFor(parsedFrom.challenge).response;
    answeredCredentialIds.push(signed.id);
    return Promise.resolve(signed);
  };
  const respond: Answer =
    answer === "sign"
      ? sign
      : typeof answer === "function"
        ? answer
        : (publicKey) => {
            setSystemTime(new Date(Date.now() + answer.signAfterMs));
            return sign(publicKey);
          };

  class StubPublicKeyCredential {
    constructor(readonly json: unknown) {}
    toJSON() {
      return this.json;
    }
    static parseCreationOptionsFromJSON(json: RegistrationOptions) {
      return { parsedFrom: json };
    }
    static parseRequestOptionsFromJSON(json: unknown) {
      return { parsedFrom: json };
    }
  }
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    writable: true,
    value: StubPublicKeyCredential,
  });
  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: {
      create: async (options: {
        readonly publicKey: { readonly parsedFrom: RegistrationOptions };
      }) => new StubPublicKeyCredential(await respond(options.publicKey)),
      get: () => Promise.resolve(null),
    },
  });
  return { answeredCredentialIds };
};

const restoreBrowser = (): void => {
  active = undefined;
  Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  if (originalCredentials === undefined) {
    Reflect.deleteProperty(globalThis.navigator, "credentials");
  } else {
    Object.defineProperty(globalThis.navigator, "credentials", originalCredentials);
  }
  globalThis.fetch = originalFetch;
};

type RegistrationOutcome =
  | { readonly kind: "registered" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly tag: string; readonly text: string };

let active: { readonly session: SignedInSession; readonly requested: string[] } | undefined;

const fetchToActiveApp = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (active === undefined) throw new Error("登録の手順を走らせていない");
  const request = new Request(input, init);
  const url = new URL(request.url);
  active.requested.push(`${request.method} ${url.pathname}`);
  const headers = new Headers(request.headers);
  headers.set("cookie", active.session.cookie);
  headers.set("sec-fetch-site", "same-origin");
  return active.session.app.request(`${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    ...(request.method === "GET" ? {} : { body: await request.text() }),
  });
}) as unknown as typeof globalThis.fetch;

const registrationThroughSpa = async (session: SignedInSession) => {
  const requested: string[] = [];
  active = { session, requested };
  globalThis.fetch = fetchToActiveApp;

  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      return yield* registerPasskey(client.passkey);
    }).pipe(
      Effect.map(
        (registration): RegistrationOutcome =>
          registration._tag === "Registered" ? { kind: "registered" } : { kind: "cancelled" },
      ),
      Effect.catch((failure) => {
        const tag = "_tag" in failure ? String(failure._tag) : "";
        const text = passkeyFailureText(
          tag in PASSKEY_TAGS ? (tag as keyof typeof PASSKEY_TAGS) : "Unexpected",
        );
        return Effect.succeed<RegistrationOutcome>({ kind: "failed", tag, text });
      }),
      Effect.provide(SpaHttpClient.layer("http://localhost:3100")),
    ),
  );
  return { ...outcome, requested };
};

const PASSKEY_TAGS = {
  RateLimited: true,
  PasskeyRejected: true,
  PasskeyAlreadyRegistered: true,
  PasskeyRegistrationUnavailable: true,
  PasskeyLimitReached: true,
  NotFound: true,
} as const satisfies Record<keyof typeof PASSKEY_FAILURE_MESSAGES, true>;

describe("画面の登録の手順を、実際の登録の API につなげる", () => {
  const { run, cleanup } = dbTest("passkey-spa-registration-test-");
  restoreKvStoreAfterEach();
  afterEach(async () => {
    setSystemTime();
    restoreBrowser();
    await cleanup();
  });

  const createUser = (name: string) =>
    run(TestDb.use((db) => db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`)));

  const savedCredentialIdsOf = async (user: { readonly id: string }) =>
    (await run(passkeysOf(user.id))).map(({ credentialId }) => credentialId);

  test("server の options を渡すと browser が作った JSON が返り、それを登録の API に送ると本人の credential が保存される", async () => {
    const owner = await createUser("creator");
    const session = signedInSession(owner);
    const options = (await requestRegistrationOptions(session)).body as RegistrationOptions;
    const browser = installBrowser("sign");

    const created = await Effect.runPromise(createPasskey(options));

    expect(created._tag).toBe("Created");
    if (created._tag !== "Created") return;
    expect((await sendRegistration(session, created.response)).status).toBe(200);
    expect(await savedCredentialIdsOf(owner)).toEqual(browser.answeredCredentialIds);
  });

  test("dialog を取り消すと結果は取り消しになり、登録の API に要求を送らず、本人の credential は増えない", async () => {
    const owner = await createUser("spa-canceller");
    installBrowser(cancelledAnswer);

    const outcome = await registrationThroughSpa(signedInSession(owner));

    expect(outcome.kind).toBe("cancelled");
    expect(outcome.requested).toEqual([OPTIONS_REQUEST]);
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });

  test("browser が作った応答を送ると結果は登録の成功になり、一覧の API に 1 行出る", async () => {
    const owner = await createUser("spa-registrant");
    const session = signedInSession(owner);
    const browser = installBrowser("sign");

    const outcome = await registrationThroughSpa(session);

    expect(outcome.kind).toBe("registered");
    expect(outcome.requested).toEqual([OPTIONS_REQUEST, REGISTER_REQUEST]);
    expect(await listedPasskeyIds(session)).toHaveLength(1);
    expect(await savedCredentialIdsOf(owner)).toEqual(browser.answeredCredentialIds);
  });

  test("options を取ってから 5 分を 1 秒過ぎて応答を送ると失敗になり、想定外の失敗とは別の文言が出る", async () => {
    const owner = await createUser("spa-late");
    installBrowser({ signAfterMs: CHALLENGE_LIFETIME_MS + ONE_SECOND_MS });

    const outcome = await registrationThroughSpa(signedInSession(owner));

    expect(outcome.kind).toBe("failed");
    if (outcome.kind !== "failed") return;
    expect(outcome.text).not.toBe("");
    expect(outcome.text).not.toBe(passkeyFailureText("Unexpected"));
    expect(await savedCredentialIdsOf(owner)).toEqual([]);
  });
});

test("SPA の API 契約がパスキーの API に宣言する失敗の種類 (未ログインと再認証が要る失敗を除く) のそれぞれに、空でない文言がある", () => {
  const texts: { readonly [tag: string]: string | undefined } = PASSKEY_FAILURE_MESSAGES;
  const tags = [
    ...new Set(
      spaEndpointTable()
        .filter(({ name }) => name.startsWith("passkey."))
        .flatMap(({ failures }) => [...failures.keys()]),
    ),
  ]
    .filter((tag) => tag !== "Unauthorized" && tag !== "ReauthenticationRequired")
    .toSorted();
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    expect({ tag, text: (texts[tag] ?? "").length > 0 }).toEqual({ tag, text: true });
  }
});
