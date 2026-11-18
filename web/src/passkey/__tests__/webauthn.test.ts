import { afterEach, describe, expect, test } from "bun:test";
import type { RegistrationOptions } from "@core/passkey/passkey-contract";
import { Effect } from "effect";

import { createPasskey } from "../webauthn";

const OPTIONS: RegistrationOptions = {
  rp: { name: "taimei", id: "auth.example.test" },
  user: { id: "dXNlcg", name: "me@example.test", displayName: "me@example.test" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
};

const originalCredentials = Object.getOwnPropertyDescriptor(globalThis.navigator, "credentials");

const installBrowser = (
  create: () => Promise<unknown>,
  { withoutRequestOptionsParser = false } = {},
) => {
  class StubPublicKeyCredential {
    constructor(readonly json: unknown) {}
    toJSON() {
      if (this.json instanceof Error) {
        throw this.json;
      }
      return this.json;
    }
    static parseCreationOptionsFromJSON(json: unknown) {
      return json;
    }
    static parseRequestOptionsFromJSON(json: unknown) {
      return json;
    }
  }
  if (withoutRequestOptionsParser) {
    Reflect.deleteProperty(StubPublicKeyCredential, "parseRequestOptionsFromJSON");
  }
  Object.defineProperty(globalThis, "PublicKeyCredential", {
    configurable: true,
    writable: true,
    value: StubPublicKeyCredential,
  });
  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: {
      create: async () => new StubPublicKeyCredential(await create()),
      get: () => Promise.resolve(null),
    },
  });
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "PublicKeyCredential");
  if (originalCredentials === undefined) {
    Reflect.deleteProperty(globalThis.navigator, "credentials");
  } else {
    Object.defineProperty(globalThis.navigator, "credentials", originalCredentials);
  }
});

const failureTagOf = async () =>
  Effect.runPromise(
    createPasskey(OPTIONS).pipe(
      Effect.match({
        onFailure: (failure) => failure._tag,
        onSuccess: (creation) => creation._tag,
      }),
    ),
  );

describe("browser の作成の API の結果を写す", () => {
  test("除外に挙げたパスキーがこの端末にあると (InvalidStateError)、登録済みの失敗になる", async () => {
    installBrowser(() => Promise.reject(new DOMException("excluded", "InvalidStateError")));
    expect(await failureTagOf()).toBe("PasskeyAlreadyRegistered");
  });

  test("browser が返した JSON が登録の API の形でないと、失敗になる", async () => {
    installBrowser(() => Promise.resolve({ id: "only-id" }));
    expect(await failureTagOf()).toBe("PasskeyCreationFailed");
  });

  test("browser の toJSON が投げると、画面を落とさずに失敗になる", async () => {
    installBrowser(() => Promise.resolve(new TypeError("toJSON is broken")));
    expect(await failureTagOf()).toBe("PasskeyCreationFailed");
  });

  test("DOMException でない NotAllowedError で拒まれても、取り消しになる", async () => {
    installBrowser(() =>
      Promise.reject(Object.assign(new Error("dismissed"), { name: "NotAllowedError" })),
    );
    expect(await failureTagOf()).toBe("Cancelled");
  });

  test("JSON の補助の API が欠けた browser では、作成の dialog を開かずに失敗になる", async () => {
    let opened = 0;
    installBrowser(
      () => {
        opened += 1;
        return Promise.resolve({});
      },
      { withoutRequestOptionsParser: true },
    );
    expect(await failureTagOf()).toBe("PasskeyCreationFailed");
    expect(opened).toBe(0);
  });

  test("WebAuthn の API の無い browser で呼ぶと、取り消しでなく失敗になる", async () => {
    expect(await failureTagOf()).toBe("PasskeyCreationFailed");
  });
});
