import { afterEach, describe, expect, test } from "bun:test";
import type { RegistrationOptions } from "@core/passkey/passkey-contract";
import { Clock, Effect } from "effect";

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
