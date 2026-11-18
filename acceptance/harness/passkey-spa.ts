import { setSystemTime } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApi } from "effect/http-api";
import { SpaApi } from "../../src/spa-contract";
import { SpaHttpClient } from "../../web/src/shared/spa-http-client";
import { authHost } from "./passkey-registration";
import { type Session, signedResponse } from "./passkey-registration-api";

export {
  createUser,
  forgetScenario,
  openSession,
  optionsOf,
  readListedIds,
  requestOptions,
  savedCredentialIdsOf,
  sendRegistration,
} from "./passkey-registration-api";

export type BrowserPart =
  | "PublicKeyCredential"
  | "navigator.credentials"
  | "parseCreationOptionsFromJSON"
  | "parseRequestOptionsFromJSON"
  | "toJSON";

type Answer = (publicKey: unknown) => Promise<unknown>;

export type BrowserRecord = {
  readonly parsedOptions: unknown[];
  readonly parsedResults: unknown[];
  readonly createdWith: unknown[];
  readonly answeredCredentialIds: string[];
};

const originalCredentials = Object.getOwnPropertyDescriptor(globalThis.navigator, "credentials");

const challengeOf = (publicKey: unknown): string => {
  const parsedFrom = (publicKey as { parsedFrom?: { challenge?: unknown } }).parsedFrom;
  if (typeof parsedFrom?.challenge !== "string") throw new Error("options の challenge が無い");
  return parsedFrom.challenge;
};

const cancelledAnswer: Answer = () =>
  Promise.reject(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"));

export const rejectedAnswer =
  (name: string): Answer =>
  () =>
    Promise.reject(new DOMException(`rejected: ${name}`, name));

export const installBrowser = ({
  without = [],
  answer = cancelledAnswer,
}: { readonly without?: readonly BrowserPart[]; readonly answer?: Answer | "sign" | { readonly signAfterMs: number } } = {}): BrowserRecord => {
  const record: BrowserRecord = {
    parsedOptions: [],
    parsedResults: [],
    createdWith: [],
    answeredCredentialIds: [],
  };
  const sign = (publicKey: unknown) => {
    const signed = signedResponse(challengeOf(publicKey)).response;
    record.answeredCredentialIds.push(signed.id);
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
    static parseCreationOptionsFromJSON(json: unknown) {
      record.parsedOptions.push(json);
      const parsed = { parsedFrom: json };
      record.parsedResults.push(parsed);
      return parsed;
    }
    static parseRequestOptionsFromJSON(json: unknown) {
      return { parsedFrom: json };
    }
  }
  if (without.includes("parseCreationOptionsFromJSON")) {
    Reflect.deleteProperty(StubPublicKeyCredential, "parseCreationOptionsFromJSON");
  }
  if (without.includes("parseRequestOptionsFromJSON")) {
    Reflect.deleteProperty(StubPublicKeyCredential, "parseRequestOptionsFromJSON");
  }
  if (without.includes("toJSON")) {
    Reflect.deleteProperty(StubPublicKeyCredential.prototype, "toJSON");
  }
  if (!without.includes("PublicKeyCredential")) {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      writable: true,
      value: StubPublicKeyCredential,
    });
  }
  if (!without.includes("navigator.credentials")) {
    Object.defineProperty(globalThis.navigator, "credentials", {
      configurable: true,
      value: {
        create: async (options: { readonly publicKey?: unknown }) => {
          record.createdWith.push(options.publicKey);
          return new StubPublicKeyCredential(await respond(options.publicKey));
        },
        get: () => Promise.resolve(null),
      },
    });
  }
  return record;
};

export const restoreBrowser = (): void => {
  Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  if (originalCredentials === undefined) {
    Reflect.deleteProperty(globalThis.navigator, "credentials");
  } else {
    Object.defineProperty(globalThis.navigator, "credentials", originalCredentials);
  }
};

export const supportJudgement = async (): Promise<boolean> => {
  const { isPasskeySupported } = await import("../../web/src/passkey/webauthn");
  return Effect.runPromise(isPasskeySupported);
};

export type CreationOutcome =
  | { readonly kind: "created"; readonly json: unknown }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly tag: string };

export const creationFrom = async (optionsJson: unknown): Promise<CreationOutcome> => {
  const { createPasskey } = await import("../../web/src/passkey/webauthn");
  return Effect.runPromise(
    createPasskey(optionsJson as Parameters<typeof createPasskey>[0]).pipe(
      Effect.map(
        (creation): CreationOutcome =>
          creation._tag === "Created" ? { kind: "created", json: creation.response } : { kind: "cancelled" },
      ),
      Effect.catch((failure) => Effect.succeed<CreationOutcome>({ kind: "failed", tag: failure._tag })),
    ),
  );
};

export const failureTextOf = async (tag: string): Promise<string | undefined> => {
  const { PASSKEY_FAILURE_MESSAGES } = await import("../../web/src/passkey/passkey-failure-messages");
  const texts: { readonly [tag: string]: string | undefined } = PASSKEY_FAILURE_MESSAGES;
  return texts[tag];
};

export const unexpectedFailureText = async (): Promise<string> => {
  const { passkeyFailureText } = await import("../../web/src/passkey/passkey-failure-messages");
  return passkeyFailureText("Unexpected");
};

export type RegistrationOutcome =
  | { readonly kind: "registered" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly tag: string; readonly text: string };

export type SpaRequests = { readonly requested: string[] };

const spaClientFor = (session: Session, requests: SpaRequests) => {
  const fetchToApp = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    requests.requested.push(`${request.method} ${url.pathname}`);
    const headers = new Headers(request.headers);
    headers.set("cookie", session.cookie);
    headers.set("sec-fetch-site", "same-origin");
    return session.app.request(`${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      ...(request.method === "GET" ? {} : { body: await request.text() }),
    });
  }) as unknown as typeof globalThis.fetch;
  return SpaHttpClient.layer(authHost().origin).pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchToApp)),
  );
};

export const registrationThroughSpa = async (
  session: Session,
): Promise<RegistrationOutcome & SpaRequests> => {
  const { registerPasskey } = await import("../../web/src/passkey/passkey-registration");
  const requests: SpaRequests = { requested: [] };
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      return yield* registerPasskey(client.passkey);
    }).pipe(
      Effect.map(
        (registration): RegistrationOutcome =>
          registration._tag === "Registered" ? { kind: "registered" } : { kind: "cancelled" },
      ),
      Effect.catch((failure) =>
        Effect.promise(async (): Promise<RegistrationOutcome> => {
          const tag = "_tag" in failure ? String(failure._tag) : "";
          return {
            kind: "failed",
            tag,
            text: (await failureTextOf(tag)) ?? (await unexpectedFailureText()),
          };
        }),
      ),
      Effect.provide(spaClientFor(session, requests)),
    ),
  );
  return { ...outcome, ...requests };
};

export const declaredPasskeyFailureTags = (): string[] => {
  const tags = new Set<string>();
  HttpApi.reflect(SpaApi, {
    onGroup: () => {},
    onEndpoint: ({ group, errors }) => {
      if (group.identifier !== "passkey") return;
      for (const schema of [...errors.values()].flat()) {
        const literal = (schema as { schema?: { fields?: { _tag?: { ast?: { literal?: unknown } } } } })
          .schema?.fields?._tag?.ast?.literal;
        if (typeof literal === "string") tags.add(literal);
      }
    },
  });
  return [...tags].sort();
};
