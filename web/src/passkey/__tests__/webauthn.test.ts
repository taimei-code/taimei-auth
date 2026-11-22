import { afterEach, describe, expect, test } from "bun:test";
import type { AuthenticationOptions, RegistrationOptions } from "@core/passkey/passkey-contract";
import { Clock, Effect } from "effect";

import { createPasskey, getPasskey, isPasskeySupported } from "../webauthn";

const OPTIONS: RegistrationOptions = {
  rp: { name: "taimei", id: "auth.example.test" },
  user: { id: "dXNlcg", name: "me@example.test", displayName: "me@example.test" },
  challenge: "Y2hhbGxlbmdl",
  pubKeyCredParams: [{ alg: -7, type: "public-key" }],
};

const originalCredentials = Object.getOwnPropertyDescriptor(globalThis.navigator, "credentials");

type BrowserPart =
  | "PublicKeyCredential"
  | "navigator.credentials"
  | "parseCreationOptionsFromJSON"
  | "parseRequestOptionsFromJSON"
  | "toJSON";

type BrowserRecord = {
  readonly parsedOptions: unknown[];
  readonly parsedResults: unknown[];
  readonly createdWith: unknown[];
};

const installBrowser = (
  create: () => Promise<unknown>,
  {
    withoutRequestOptionsParser = false,
    without = [],
    record,
    get = () => Promise.resolve(null),
  }: {
    withoutRequestOptionsParser?: boolean;
    without?: readonly BrowserPart[];
    record?: BrowserRecord;
    get?: () => Promise<unknown>;
  } = {},
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
      if (record === undefined) {
        return json;
      }
      const parsed = { parsedFrom: json };
      record.parsedOptions.push(json);
      record.parsedResults.push(parsed);
      return parsed;
    }
    static parseRequestOptionsFromJSON(json: unknown) {
      return json;
    }
  }
  if (withoutRequestOptionsParser || without.includes("parseRequestOptionsFromJSON")) {
    Reflect.deleteProperty(StubPublicKeyCredential, "parseRequestOptionsFromJSON");
  }
  if (without.includes("parseCreationOptionsFromJSON")) {
    Reflect.deleteProperty(StubPublicKeyCredential, "parseCreationOptionsFromJSON");
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
          record?.createdWith.push(options.publicKey);
          return new StubPublicKeyCredential(await create());
        },
        get: async () => new StubPublicKeyCredential(await get()),
      },
    });
  }
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

describe("browser の作成の API を呼ぶ", () => {
  test("browser の作成の API には、server の options を parseCreationOptionsFromJSON で変換した値が渡る", async () => {
    const record: BrowserRecord = { parsedOptions: [], parsedResults: [], createdWith: [] };
    installBrowser(() => Promise.resolve({ id: "only-id" }), { record });

    await failureTagOf();

    expect(record.parsedOptions).toEqual([OPTIONS]);
    expect(record.createdWith).toHaveLength(1);
    expect(record.createdWith[0]).toBe(record.parsedResults[0]);
  });
});

describe("browser がパスキーに対応しているかの判定", () => {
  const supported = () => Effect.runPromise(isPasskeySupported);

  const missingWebAuthn: readonly BrowserPart[] = ["PublicKeyCredential", "navigator.credentials"];
  for (const part of missingWebAuthn) {
    test(`${part} が無い browser では、対応していないと判定する`, async () => {
      installBrowser(() => Promise.resolve({}), { without: [part] });
      expect(await supported()).toBe(false);
    });
  }

  const missingJsonHelpers: readonly BrowserPart[] = [
    "parseCreationOptionsFromJSON",
    "parseRequestOptionsFromJSON",
    "toJSON",
  ];
  for (const part of missingJsonHelpers) {
    test(`WebAuthn の API はあるが ${part} が無い browser では、対応していないと判定する`, async () => {
      installBrowser(() => Promise.resolve({}), { without: [part] });
      expect(await supported()).toBe(false);
    });
  }

  test("WebAuthn の API と JSON の補助の API が揃った browser では、対応していると判定する", async () => {
    installBrowser(() => Promise.resolve({}));
    expect(await supported()).toBe(true);
  });
});

describe("dialog の取り消しと失敗", () => {
  test("browser が NotAllowedError で拒んだ時 (dialog の取り消し) は、失敗でなく取り消しとして返る", async () => {
    installBrowser(() =>
      Promise.reject(
        new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"),
      ),
    );
    expect(await failureTagOf()).toBe("Cancelled");
  });

  for (const name of ["SecurityError", "UnknownError"]) {
    test(`browser が ${name} で拒んだ時は、取り消しでなく失敗として返る`, async () => {
      installBrowser(() => Promise.reject(new DOMException(`rejected: ${name}`, name)));
      expect(await failureTagOf()).toBe("PasskeyCreationFailed");
    });
  }
});

const FIVE_MINUTES_MS = 300_000;
const NANOS_PER_MILLI = 1_000_000n;

const clockReading = (...readingsMs: ReadonlyArray<number>): Clock.Clock => {
  const remaining = readingsMs.map((ms) => BigInt(ms) * NANOS_PER_MILLI);
  const next = () => remaining.shift() ?? 0n;
  return {
    currentTimeMillisUnsafe: () => 0,
    currentTimeMillis: Effect.succeed(0),
    currentTimeNanosUnsafe: () => 0n,
    currentTimeNanos: Effect.succeed(0n),
    monotonicTimeNanosUnsafe: next,
    monotonicTimeNanos: Effect.sync(next),
    sleep: () => Effect.void,
  };
};

const outcomeAfter = (options: RegistrationOptions, elapsedMs: number) => {
  installBrowser(() => Promise.reject(new DOMException("dismissed", "NotAllowedError")));
  return Effect.runPromise(
    createPasskey(options).pipe(
      Effect.match({
        onFailure: (failure) => failure._tag,
        onSuccess: (creation) => creation._tag,
      }),
      Effect.provideService(Clock.Clock, clockReading(0, elapsedMs)),
    ),
  );
};

describe("browser の dialog が NotAllowedError で閉じた時に、取り消しと時間切れを経過時間で分ける", () => {
  test("options の timeout を過ぎてから閉じると、時間切れとしてやり直しを促す失敗 (PasskeyRejected) になる", async () => {
    expect(await outcomeAfter({ ...OPTIONS, timeout: FIVE_MINUTES_MS }, FIVE_MINUTES_MS)).toBe(
      "PasskeyRejected",
    );
  });

  test("browser の timer が 1 秒早く切れても、時間切れとして扱う", async () => {
    expect(
      await outcomeAfter({ ...OPTIONS, timeout: FIVE_MINUTES_MS }, FIVE_MINUTES_MS - 1_000),
    ).toBe("PasskeyRejected");
  });

  test("timeout より前に閉じると、誤りを出さない取り消しになる", async () => {
    expect(await outcomeAfter({ ...OPTIONS, timeout: FIVE_MINUTES_MS }, 10_000)).toBe("Cancelled");
  });

  test("timeout の無い options では、どれだけ経っても取り消しになる", async () => {
    expect(await outcomeAfter(OPTIONS, FIVE_MINUTES_MS * 10)).toBe("Cancelled");
  });
});

const AUTHENTICATION_OPTIONS: AuthenticationOptions = {
  challenge: "Y2hhbGxlbmdl",
  timeout: FIVE_MINUTES_MS,
  rpId: "auth.example.test",
  userVerification: "required",
};

const ASSERTION_JSON = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  response: {
    clientDataJSON: "e30",
    authenticatorData: "YXV0aA",
    signature: "c2ln",
    userHandle: "dXNlcg",
  },
  clientExtensionResults: {},
};

const assertionOutcome = (get: () => Promise<unknown>, elapsedMs = 0) => {
  installBrowser(() => Promise.resolve({}), { get });
  return Effect.runPromise(
    getPasskey(AUTHENTICATION_OPTIONS).pipe(
      Effect.match({
        onFailure: (failure) => failure._tag,
        onSuccess: (assertion) => assertion._tag,
      }),
      Effect.provideService(Clock.Clock, clockReading(0, elapsedMs)),
    ),
  );
};

describe("browser の認証の API の結果を写す", () => {
  test("browser が返した応答の JSON は、ログインの API に送れる形で返る", async () => {
    installBrowser(() => Promise.resolve({}), { get: () => Promise.resolve(ASSERTION_JSON) });
    const assertion = await Effect.runPromise(getPasskey(AUTHENTICATION_OPTIONS));
    expect(assertion).toMatchObject({ _tag: "Asserted", response: ASSERTION_JSON });
  });

  test("timeout より前に NotAllowedError で閉じると、誤りを出さない取り消しになる", async () => {
    expect(
      await assertionOutcome(
        () => Promise.reject(new DOMException("dismissed", "NotAllowedError")),
        10_000,
      ),
    ).toBe("Cancelled");
  });

  test("options の timeout を過ぎてから NotAllowedError で閉じると、取り消しでなく失敗になる", async () => {
    expect(
      await assertionOutcome(
        () => Promise.reject(new DOMException("dismissed", "NotAllowedError")),
        FIVE_MINUTES_MS,
      ),
    ).toBe("PasskeyAssertionFailed");
  });

  test("browser が SecurityError で拒むと、取り消しでなく失敗になる", async () => {
    expect(
      await assertionOutcome(() => Promise.reject(new DOMException("rejected", "SecurityError"))),
    ).toBe("PasskeyAssertionFailed");
  });

  test("browser が返した JSON がログインの API の形でないと、失敗になる", async () => {
    expect(await assertionOutcome(() => Promise.resolve({ id: "only-id" }))).toBe(
      "PasskeyAssertionFailed",
    );
  });

  test("WebAuthn の API の無い browser で呼ぶと、取り消しでなく失敗になる", async () => {
    const outcome = await Effect.runPromise(
      getPasskey(AUTHENTICATION_OPTIONS).pipe(
        Effect.match({
          onFailure: (failure) => failure._tag,
          onSuccess: (assertion) => assertion._tag,
        }),
      ),
    );
    expect(outcome).toBe("PasskeyAssertionFailed");
  });
});
