import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { partial } from "../../__tests__/live-runner";
import { testTtlStore } from "../../__tests__/test-ttl-store";
import { signedIn } from "../../membership/__tests__/test-layers";
import { MfaTotpRepo } from "../../mfa/totp/ports";
import { PasskeyRepo } from "../../passkey/ports";
import { ttlStoreLayer } from "../../ttl-store-service";
import { JSON_HEADERS } from "../client-facing-error";
import { buildAppWith, freshSessionCookie } from "./helpers";

const clientData = Buffer.from(
  JSON.stringify({
    type: "webauthn.create",
    challenge: "bm90LWlzc3VlZC1ieS10aGlzLXNlcnZlci0wMDAwMDAwMDA",
    origin: "https://unused.example",
  }),
).toString("base64url");

const browserShapedResponse = {
  id: "Y3JlZGVudGlhbA",
  rawId: "Y3JlZGVudGlhbA",
  type: "public-key",
  authenticatorAttachment: null,
  clientExtensionResults: { credProps: { rk: true } },
  response: {
    clientDataJSON: clientData,
    attestationObject: "o2NmbXRkbm9uZQ",
    authenticatorData: Buffer.from("authenticator-data").toString("base64url"),
    publicKey: Buffer.from("public-key").toString("base64url"),
    publicKeyAlgorithm: -7,
    transports: ["internal", "hybrid", "some-future-transport"],
  },
};

const register = (body: unknown, app = buildAppWith(signedIn())) =>
  app.request("/api/account/passkeys", {
    method: "POST",
    headers: {
      ...JSON_HEADERS,
      "sec-fetch-site": "same-origin",
      ...freshSessionCookie(),
    },
    body: JSON.stringify(body),
  });

describe("パスキーの登録の要求の形", () => {
  test("browser の toJSON() が足す鍵、null の authenticatorAttachment、未知の transports を含む応答は、要求の形の検査を通って検証で落ちる", async () => {
    const res = await register(browserShapedResponse);

    expect(res.status).toBe(400);
    expect(await res.text()).toBe(JSON.stringify({ _tag: "PasskeyRejected" }));
  });

  test("response を欠く要求は、検証に届かず要求の形の検査で落ちる", async () => {
    const { response: _dropped, ...withoutResponse } = browserShapedResponse;

    const res = await register(withoutResponse);

    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("PasskeyRejected");
  });

  test("発行した challenge の形でない challenge の応答は、TTL store を引かずに検証で落ちる", async () => {
    const taken: string[] = [];
    const app = buildAppWith(
      Layer.merge(
        signedIn(),
        ttlStoreLayer({
          ...testTtlStore,
          getAndDelete: async (key) => {
            taken.push(key);
            return testTtlStore.getAndDelete(key);
          },
        }),
      ),
    );

    const res = await register(browserShapedResponse, app);

    expect(await res.text()).toBe(JSON.stringify({ _tag: "PasskeyRejected" }));
    expect(taken).toEqual([]);
  });

  test("options の応答は、browser の作成の dialog が要る鍵を、生体か PIN の必須と登録済みの credential の除外を含めて返し、dialog は challenge の 5 分より先に切れる", async () => {
    const registered = {
      credentialId: "cmVnaXN0ZXJlZC1jcmVkZW50aWFs",
      transports: ["internal", "hybrid"] as Array<"internal" | "hybrid">,
    };
    const app = buildAppWith(
      Layer.mergeAll(
        signedIn("u-options", "owner@example.com"),
        Layer.succeed(
          MfaTotpRepo,
          partial<MfaTotpRepo["Service"]>({ readMfaStatusRow: () => Effect.succeed(undefined) }),
        ),
        Layer.succeed(
          PasskeyRepo,
          partial<PasskeyRepo["Service"]>({
            listPasskeys: () =>
              Effect.succeed([
                {
                  ...registered,
                  id: "pk-1",
                  userId: "u-options",
                  publicKey: new Uint8Array([1]),
                  counter: 0,
                  aaguid: "00000000-0000-0000-0000-000000000000",
                  createdAt: new Date(),
                  lastUsedAt: null,
                },
              ]),
          }),
        ),
      ),
    );

    const res = await app.request("/api/account/passkeys/registration-options", {
      method: "POST",
      headers: { ...JSON_HEADERS, "sec-fetch-site": "same-origin", ...freshSessionCookie() },
      body: "{}",
    });

    expect(res.status).toBe(200);
    const body: { readonly timeout?: number } = await res.json();
    expect(body).toMatchObject({
      rp: { id: new URL(process.env.AUTH_SERVICE_URL ?? "").hostname },
      user: {
        id: Buffer.from("u-options").toString("base64url"),
        name: "owner@example.com",
        displayName: "owner@example.com",
      },
      pubKeyCredParams: [
        { alg: -8, type: "public-key" },
        { alg: -7, type: "public-key" },
        { alg: -257, type: "public-key" },
      ],
      authenticatorSelection: { userVerification: "required", residentKey: "required" },
      excludeCredentials: [
        { id: registered.credentialId, type: "public-key", transports: registered.transports },
      ],
      extensions: { credProps: true },
    });
    expect(body.timeout).toBeLessThan(5 * 60 * 1000);
  });
});
