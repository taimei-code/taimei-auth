import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { fakeFlagship } from "../../../testing/feature-flags";
import { parseClientFacingError } from "../../handlers/client-facing-error";
import { dbTest, partial } from "../../__tests__/live-runner";
import { TestDb } from "../../__tests__/test-db";
import { DbError, TtlStoreError } from "../../errors";
import { MemoryKvStore } from "../../kv-store.memory";
import { memoryBackend } from "../../ttl-store";
import { TtlStore, ttlStoreLayer } from "../../ttl-store-service";
import { PasskeyRejected } from "../errors";
import { PasskeyRepo } from "../ports";
import { authenticationOptions, verifyAuthentication, verifyRegistration } from "../webauthn";
import {
  authHost,
  savePasskey,
  type SignatureAlgorithm,
  signedAuthentication,
  signedRegistration,
} from "./helpers";

const flagsOn = fakeFlagship().layer;

const ISSUED = "Y2hhbGxlbmdlLWlzc3VlZC1ieS10aGUtb3B0aW9ucw";

const clientDataCarrying = (challenge: unknown) =>
  Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge, origin: "https://unused.example" }),
  ).toString("base64url");

const registrationCarrying = (challenge: unknown) => ({
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key" as const,
  clientExtensionResults: {},
  response: { clientDataJSON: clientDataCarrying(challenge), attestationObject: "" },
});

const authenticationCarrying = (challenge: unknown) => ({
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key" as const,
  clientExtensionResults: {},
  response: { clientDataJSON: clientDataCarrying(challenge), authenticatorData: "", signature: "" },
});

const storeAnswering = (getAndDelete: TtlStore["Service"]["getAndDelete"]) =>
  partial<TtlStore["Service"]>({ getAndDelete });

const storeDown = storeAnswering(() => Effect.fail(new TtlStoreError({ cause: "store down" })));

describe("登録の応答の challenge を TTL store から取り出す", () => {
  test("TTL store の障害は、不正な応答の失敗に変えず、そのまま返す", async () => {
    const failure = await Effect.runPromise(
      verifyRegistration({ userId: "u", response: registrationCarrying(ISSUED) }).pipe(
        Effect.flip,
        Effect.provide(flagsOn),
        Effect.provideService(TtlStore, storeDown),
      ),
    );
    expect(failure).toBeInstanceOf(TtlStoreError);
  });

  test("base64url の 1〜128 文字でない challenge と文字列でない challenge は、TTL store を引かずに不正な応答の失敗になる", async () => {
    for (const challenge of ["A".repeat(129), "a+b", "", ["Y2hhbGxlbmdl"], 42, null]) {
      const looked: string[] = [];
      const failure = await Effect.runPromise(
        verifyRegistration({ userId: "u", response: registrationCarrying(challenge) }).pipe(
          Effect.flip,
          Effect.provide(flagsOn),
          Effect.provideService(
            TtlStore,
            storeAnswering((key) => Effect.sync(() => (looked.push(key), "u"))),
          ),
        ),
      );
      expect(looked).toEqual([]);
      expect(failure).toBeInstanceOf(PasskeyRejected);
    }
  });

  test("128 文字の challenge は TTL store を引く", async () => {
    const looked: string[] = [];
    await Effect.runPromise(
      verifyRegistration({ userId: "u", response: registrationCarrying("A".repeat(128)) }).pipe(
        Effect.flip,
        Effect.provide(flagsOn),
        Effect.provideService(
          TtlStore,
          storeAnswering((key) => Effect.sync(() => (looked.push(key), null))),
        ),
      ),
    );
    expect(looked).toHaveLength(1);
  });
});

describe("認証の応答の challenge と行", () => {
  test("TTL store の障害は、不正な応答の失敗に変えず、そのまま返す", async () => {
    const failure = await Effect.runPromise(
      verifyAuthentication({ response: authenticationCarrying(ISSUED) }).pipe(
        Effect.flip,
        Effect.provide(flagsOn),
        Effect.provideService(TtlStore, storeDown),
        Effect.provideService(PasskeyRepo, partial<PasskeyRepo["Service"]>({})),
      ),
    );
    expect(failure).toBeInstanceOf(TtlStoreError);
  });

  test("base64url の文字でない credential の id の応答は、行を引かずに不正な応答の失敗になる", async () => {
    const looked: string[] = [];
    const failure = await Effect.runPromise(
      verifyAuthentication({
        response: { ...authenticationCarrying(ISSUED), id: "ab\u0000cd", rawId: "ab\u0000cd" },
      }).pipe(
        Effect.flip,
        Effect.provide(flagsOn),
        Effect.provideService(
          TtlStore,
          storeAnswering(() => Effect.succeed("/account")),
        ),
        Effect.provideService(
          PasskeyRepo,
          partial<PasskeyRepo["Service"]>({
            findPasskeyByCredentialId: (id) => Effect.sync(() => (looked.push(id), undefined)),
          }),
        ),
      ),
    );
    expect(looked).toEqual([]);
    expect(failure).toBeInstanceOf(PasskeyRejected);
  });

  test("行の引き当てが DB で失敗すると、不正な応答の失敗に変えず、その失敗のまま返す", async () => {
    const failure = await Effect.runPromise(
      verifyAuthentication({ response: authenticationCarrying(ISSUED) }).pipe(
        Effect.flip,
        Effect.provide(flagsOn),
        Effect.provideService(
          TtlStore,
          storeAnswering(() => Effect.succeed("/account")),
        ),
        Effect.provideService(
          PasskeyRepo,
          partial<PasskeyRepo["Service"]>({
            findPasskeyByCredentialId: () => Effect.fail(new DbError({ cause: "db down" })),
          }),
        ),
      ),
    );
    expect(failure).toBeInstanceOf(DbError);
  });
});

const SIGNED_CHALLENGE = "Y2hhbGxlbmdlLWZyb20tdGhlLW9wdGlvbnM";
const OTHER_HOST = "evil.example.net";
const KNOWN_TRANSPORTS = ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"];
const CLIENT_ERROR = { min: 400, max: 499 };
const ENTRUSTED_TO = "user-holding-the-challenge";

const acceptAll = () => true;

const storeHolding = (issued: (challenge: string) => boolean, entrusted: string) =>
  storeAnswering((key) =>
    Effect.succeed(issued(key.slice(key.lastIndexOf(":") + 1)) ? entrusted : null),
  );

type VerificationOutcome =
  | {
      readonly accepted: {
        readonly id: string;
        readonly publicKey: Uint8Array;
        readonly counter: number;
        readonly aaguid: string;
        readonly transports: readonly string[] | undefined;
      };
    }
  | { readonly rejected: { readonly tag: string; readonly status: number } };

type AuthenticationOutcome =
  | { readonly accepted: { readonly userId: string; readonly counter: number } }
  | { readonly rejected: { readonly tag: string; readonly status: number } };

const rejection = (failure: unknown) => {
  const clientFacing = parseClientFacingError(failure);
  return { rejected: { tag: clientFacing?.tag ?? "", status: clientFacing?.status ?? 0 } };
};

const verifyRegistrationResponseOf = (
  response: ReturnType<typeof signedRegistration>["response"],
  matchesChallenge: (challenge: string) => boolean,
): Promise<VerificationOutcome> =>
  Effect.runPromise(
    verifyRegistration({ userId: ENTRUSTED_TO, response }).pipe(
      Effect.map(
        (passkey): VerificationOutcome => ({
          accepted: {
            id: passkey.credentialId,
            publicKey: new Uint8Array(passkey.publicKey),
            counter: passkey.counter,
            aaguid: passkey.aaguid,
            transports: passkey.transports,
          },
        }),
      ),
      Effect.catch((failure) => Effect.succeed<VerificationOutcome>(rejection(failure))),
      Effect.provide(flagsOn),
      Effect.provideService(TtlStore, storeHolding(matchesChallenge, ENTRUSTED_TO)),
    ),
  );

const expectRejected = (outcome: VerificationOutcome | AuthenticationOutcome) => {
  expect(outcome).toHaveProperty("rejected");
  if (!("rejected" in outcome)) return "";
  expect(outcome.rejected.status).toBeGreaterThanOrEqual(CLIENT_ERROR.min);
  expect(outcome.rejected.status).toBeLessThanOrEqual(CLIENT_ERROR.max);
  return outcome.rejected.tag;
};

const rejectedRegistration = (
  overrides: Partial<Parameters<typeof signedRegistration>[0]>,
  matchesChallenge: (challenge: string) => boolean = acceptAll,
) =>
  verifyRegistrationResponseOf(
    signedRegistration({
      algorithm: "ES256",
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
      ...overrides,
    }).response,
    matchesChallenge,
  );

const registrationRejections = {
  unverifiedEs256: () => rejectedRegistration({ userVerified: false }),
  unverifiedRs256: () => rejectedRegistration({ algorithm: "RS256", userVerified: false }),
  otherOrigin: () => rejectedRegistration({ origin: `https://${OTHER_HOST}` }),
  otherRpId: () => rejectedRegistration({ rpId: OTHER_HOST }),
  challengeNotMatching: () => rejectedRegistration({}, () => false),
  signatureMismatch: () => rejectedRegistration({ signatureMismatch: true }),
  algorithmOutsideTheFixedSet: () => rejectedRegistration({ algorithm: "ML-DSA-44" }),
};

describe("パスキーの登録の応答の検証", () => {
  const acceptedCase = (algorithm: SignatureAlgorithm) => async () => {
    const { response, made } = signedRegistration({
      algorithm,
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
    });
    const seen: string[] = [];
    const outcome = await verifyRegistrationResponseOf(response, (challenge) => {
      seen.push(challenge);
      return true;
    });
    expect(outcome).toEqual({ accepted: made });
    expect(seen).toEqual([SIGNED_CHALLENGE]);
  };

  test(
    "正しく署名した ES256 の応答は検証を通り、作った credential の id、公開鍵、counter、aaguid、transports が得られ、照合には応答の challenge が渡る",
    acceptedCase("ES256"),
  );

  test(
    "正しく署名した RS256 の応答は検証を通り、作った credential の id、公開鍵、counter、aaguid、transports が得られ、照合には応答の challenge が渡る",
    acceptedCase("RS256"),
  );

  test("生体か PIN の確認が無い応答は、ES256 でも RS256 でも既知の失敗になる", async () => {
    expectRejected(await registrationRejections.unverifiedEs256());
    expectRejected(await registrationRejections.unverifiedRs256());
  });

  test("auth ホストと違う origin で作った応答は既知の失敗になる", async () => {
    expectRejected(await registrationRejections.otherOrigin());
  });

  test("auth ホストの host と違う RP ID で作った応答は既知の失敗になる", async () => {
    expectRejected(await registrationRejections.otherRpId());
  });

  test("challenge の照合が偽を返した応答は既知の失敗になる", async () => {
    expectRejected(await registrationRejections.challengeNotMatching());
  });

  test("署名が合わない応答は既知の失敗になる", async () => {
    expectRejected(await registrationRejections.signatureMismatch());
  });

  test("正しく署名した ML-DSA-44 の応答は、検証する実行環境が ML-DSA-44 を扱えても既知の失敗になる", async () => {
    expectRejected(await registrationRejections.algorithmOutsideTheFixedSet());
  });

  test("不正な応答の失敗は、どの理由でも同じ 1 種類の既知の失敗で、4xx の状態を持つ", async () => {
    const tags = new Set<string>();
    for (const reject of Object.values(registrationRejections)) {
      tags.add(expectRejected(await reject()));
    }
    expect(tags.size).toBe(1);
  });

  test("応答の transports に未知の文字列や文字列でない要素が混じっていても、結果の transports は既知の値だけを持ち、含まれた既知の値は失わない", async () => {
    const outcome = await verifyRegistrationResponseOf(
      signedRegistration({
        algorithm: "ES256",
        challenge: SIGNED_CHALLENGE,
        userVerified: true,
        transports: ["usb", "x".repeat(10_000), 42, null, { usb: true }, "usb", "hybrid"],
      }).response,
      acceptAll,
    );

    expect(outcome).toHaveProperty("accepted");
    const transports = "accepted" in outcome ? (outcome.accepted.transports ?? []) : [];
    expect(transports.every((transport) => KNOWN_TRANSPORTS.includes(transport))).toBe(true);
    expect(new Set(transports)).toEqual(new Set(["usb", "hybrid"]));
  });

  test("credential の id が 1,024 byte の応答は、4xx の既知の失敗になる", async () => {
    expectRejected(
      await verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: SIGNED_CHALLENGE,
          userVerified: true,
          credentialIdBytes: 1024,
        }).response,
        acceptAll,
      ),
    );
  });

  test("credential の id が 1,023 byte の応答は検証を通り、その credential の id が得られる", async () => {
    const { response, made } = signedRegistration({
      algorithm: "ES256",
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
      credentialIdBytes: 1023,
    });

    const outcome = await verifyRegistrationResponseOf(response, acceptAll);

    expect(outcome).toHaveProperty("accepted");
    expect("accepted" in outcome ? outcome.accepted.id : "").toBe(made.id);
  });
});

describe("パスキーの認証の応答の検証", () => {
  const { run, cleanup } = dbTest("passkey-authentication-test-");
  afterEach(cleanup);

  const createUser = (name: string): Promise<string> =>
    run(TestDb.use((db) => db.seedUser(`${name}-${crypto.randomUUID().slice(0, 8)}`))).then(
      ({ id }) => id,
    );

  const savedCredential = async (
    userId: string,
    algorithm: SignatureAlgorithm = "ES256",
    counter = 0,
  ) => {
    const { made, signer } = signedRegistration({
      algorithm,
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
    });
    await run(
      savePasskey(userId, {
        credentialId: made.id,
        publicKey: made.publicKey,
        counter,
        aaguid: made.aaguid,
        transports: made.transports,
      }),
    );
    return { credentialId: made.id, signer };
  };

  const verifyAuthenticationResponseOf = (
    response: ReturnType<typeof signedAuthentication>,
    matchesChallenge: (challenge: string) => boolean,
  ): Promise<AuthenticationOutcome> =>
    run(
      verifyAuthentication({ response }).pipe(
        Effect.flatMap((verified) =>
          PasskeyRepo.use((repo) => repo.findPasskeyByCredentialId(response.id)).pipe(
            Effect.map(
              (row): AuthenticationOutcome => ({
                accepted: { userId: verified.userId, counter: row?.counter ?? Number.NaN },
              }),
            ),
          ),
        ),
        Effect.catch((failure) => Effect.succeed<AuthenticationOutcome>(rejection(failure))),
        Effect.provide(flagsOn),
        Effect.provideService(TtlStore, storeHolding(matchesChallenge, "/account")),
      ),
    );

  const unregisteredResponse = () => {
    const { response, signer } = signedRegistration({
      algorithm: "ES256",
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
    });
    return signedAuthentication({
      credentialId: response.id,
      signer,
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
      counter: 1,
    });
  };

  const otherKeyResponse = async (userId: string) => {
    const target = await savedCredential(userId);
    const other = await savedCredential(userId);
    return signedAuthentication({
      credentialId: target.credentialId,
      signer: other.signer,
      challenge: SIGNED_CHALLENGE,
      userVerified: true,
      counter: 1,
    });
  };

  const responseOf = async (
    userId: string,
    overrides: {
      readonly userVerified?: boolean;
      readonly origin?: string;
      readonly rpId?: string;
    } = {},
    algorithm: SignatureAlgorithm = "ES256",
  ) => {
    const { credentialId, signer } = await savedCredential(userId, algorithm);
    return signedAuthentication({
      credentialId,
      signer,
      challenge: SIGNED_CHALLENGE,
      userVerified: overrides.userVerified ?? true,
      counter: 1,
      origin: overrides.origin,
      rpId: overrides.rpId,
    });
  };

  const acceptedCase = (algorithm: SignatureAlgorithm) => async () => {
    const owner = await createUser("owner");
    const { credentialId, signer } = await savedCredential(owner, algorithm);
    const seen: string[] = [];

    const outcome = await verifyAuthenticationResponseOf(
      signedAuthentication({
        credentialId,
        signer,
        challenge: SIGNED_CHALLENGE,
        userVerified: true,
        counter: 3,
      }),
      (challenge) => {
        seen.push(challenge);
        return true;
      },
    );

    expect(outcome).toEqual({ accepted: { userId: owner, counter: 3 } });
    expect(seen).toEqual([SIGNED_CHALLENGE]);
  };

  test(
    "保存した ES256 の credential の鍵で正しく署名した応答は検証を通り、保存した user と応答の counter が得られ、照合には応答の challenge が渡る",
    acceptedCase("ES256"),
  );

  test(
    "保存した RS256 の credential の鍵で正しく署名した応答は検証を通り、保存した user と応答の counter が得られる",
    acceptedCase("RS256"),
  );

  test("どの user も保存していない credential の応答は既知の失敗になる", async () => {
    expectRejected(await verifyAuthenticationResponseOf(unregisteredResponse(), acceptAll));
  });

  test("保存した credential の id で、保存した別の credential の鍵で署名した応答は既知の失敗になる", async () => {
    const owner = await createUser("owner");
    expectRejected(await verifyAuthenticationResponseOf(await otherKeyResponse(owner), acceptAll));
  });

  test("生体か PIN の確認が無い応答は、ES256 でも RS256 でも既知の失敗になる", async () => {
    const owner = await createUser("owner");
    for (const algorithm of ["ES256", "RS256"] as const) {
      expectRejected(
        await verifyAuthenticationResponseOf(
          await responseOf(owner, { userVerified: false }, algorithm),
          acceptAll,
        ),
      );
    }
  });

  test("auth ホストと違う origin の応答と、auth ホストの host と違う RP ID の応答は既知の失敗になる", async () => {
    const owner = await createUser("owner");
    expectRejected(
      await verifyAuthenticationResponseOf(
        await responseOf(owner, { origin: `https://${OTHER_HOST}` }),
        acceptAll,
      ),
    );
    expectRejected(
      await verifyAuthenticationResponseOf(
        await responseOf(owner, { rpId: OTHER_HOST }),
        acceptAll,
      ),
    );
  });

  test("challenge の照合が偽を返した応答は既知の失敗になる", async () => {
    const owner = await createUser("owner");
    expectRejected(await verifyAuthenticationResponseOf(await responseOf(owner), () => false));
  });

  test("不正な認証の応答の失敗は、どの理由でも同じ 1 種類の既知の失敗である", async () => {
    const owner = await createUser("owner");
    const outcomes = [
      await verifyAuthenticationResponseOf(unregisteredResponse(), acceptAll),
      await verifyAuthenticationResponseOf(await otherKeyResponse(owner), acceptAll),
      await verifyAuthenticationResponseOf(
        await responseOf(owner, { userVerified: false }),
        acceptAll,
      ),
      await verifyAuthenticationResponseOf(
        await responseOf(owner, { origin: `https://${OTHER_HOST}` }),
        acceptAll,
      ),
      await verifyAuthenticationResponseOf(
        await responseOf(owner, { rpId: OTHER_HOST }),
        acceptAll,
      ),
      await verifyAuthenticationResponseOf(await responseOf(owner), () => false),
    ];
    expect(new Set(outcomes.map(expectRejected)).size).toBe(1);
  });
});

describe("パスキーの認証の options", () => {
  test("生体か PIN の確認を必須にし、credential を 1 つも指定せず、RP ID は auth ホストの host である", async () => {
    const options = await Effect.runPromise(
      authenticationOptions({ redirectUrl: undefined }).pipe(
        Effect.provide(Layer.merge(flagsOn, ttlStoreLayer(memoryBackend(new MemoryKvStore())))),
      ),
    );
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.rpId).toBe(authHost().hostname);
  });
});
