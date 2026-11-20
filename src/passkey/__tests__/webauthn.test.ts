import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { fakeFlagship } from "../../../testing/feature-flags";
import { partial } from "../../__tests__/live-runner";
import { DbError, TtlStoreError } from "../../errors";
import { TtlStore } from "../../ttl-store-service";
import { PasskeyRejected } from "../errors";
import { PasskeyRepo } from "../ports";
import { verifyAuthentication, verifyRegistration } from "../webauthn";

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
