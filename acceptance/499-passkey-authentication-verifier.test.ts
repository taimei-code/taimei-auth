import { afterEach, describe, expect, test } from "bun:test";
import {
  type AuthenticationOutcome,
  authenticationOptionsFor,
  authHost,
  passkeyFoundBy,
  recordUse,
  signedAuthentication,
  signedRegistration,
  type SignatureAlgorithm,
  verifyAuthenticationResponseOf,
} from "./harness/passkey-registration";
import { createUser, passkeysOf, removeCreatedUsers, savePasskey } from "./harness/passkey-storage";

const CHALLENGE = "Y2hhbGxlbmdlLWZyb20tdGhlLWxvZ2luLW9wdGlvbnM";
const OTHER_HOST = "evil.example.net";
const CLIENT_ERROR = { min: 400, max: 499 };
const acceptAll = () => true;

const savedCredential = async (userId: string, algorithm: SignatureAlgorithm = "ES256", counter = 0) => {
  const { made, signer } = signedRegistration({ algorithm, challenge: CHALLENGE, userVerified: true });
  await savePasskey(userId, {
    credentialId: made.id,
    publicKey: made.publicKey,
    counter,
    aaguid: made.aaguid,
    transports: made.transports,
  });
  return { credentialId: made.id, signer };
};

const expectRejected = (outcome: AuthenticationOutcome) => {
  expect(outcome).toHaveProperty("rejected");
  if (!("rejected" in outcome)) return "";
  expect(outcome.rejected.status).toBeGreaterThanOrEqual(CLIENT_ERROR.min);
  expect(outcome.rejected.status).toBeLessThanOrEqual(CLIENT_ERROR.max);
  return outcome.rejected.tag;
};

const unregisteredResponse = async () => {
  const { response, signer } = signedRegistration({ algorithm: "ES256", challenge: CHALLENGE, userVerified: true });
  return signedAuthentication({
    credentialId: response.id,
    signer,
    challenge: CHALLENGE,
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
    challenge: CHALLENGE,
    userVerified: true,
    counter: 1,
  });
};

const responseOf = async (
  userId: string,
  overrides: { readonly userVerified?: boolean; readonly origin?: string; readonly rpId?: string } = {},
  algorithm: SignatureAlgorithm = "ES256",
) => {
  const { credentialId, signer } = await savedCredential(userId, algorithm);
  return signedAuthentication({
    credentialId,
    signer,
    challenge: CHALLENGE,
    userVerified: overrides.userVerified ?? true,
    counter: 1,
    origin: overrides.origin,
    rpId: overrides.rpId,
  });
};

describe("パスキーの認証の応答の検証", () => {
  afterEach(removeCreatedUsers);

  const acceptedCase = (algorithm: SignatureAlgorithm) => async () => {
    const owner = await createUser("owner");
    const { credentialId, signer } = await savedCredential(owner, algorithm);
    const seen: string[] = [];

    const outcome = await verifyAuthenticationResponseOf(
      signedAuthentication({ credentialId, signer, challenge: CHALLENGE, userVerified: true, counter: 3 }),
      (challenge) => {
        seen.push(challenge);
        return true;
      },
    );

    expect(outcome).toEqual({ accepted: { userId: owner, counter: 3 } });
    expect(seen).toEqual([CHALLENGE]);
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
    expectRejected(await verifyAuthenticationResponseOf(await unregisteredResponse(), acceptAll));
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
      await verifyAuthenticationResponseOf(await responseOf(owner, { rpId: OTHER_HOST }), acceptAll),
    );
  });

  test("challenge の照合が偽を返した応答は既知の失敗になる", async () => {
    const owner = await createUser("owner");
    expectRejected(await verifyAuthenticationResponseOf(await responseOf(owner), () => false));
  });

  test("不正な認証の応答の失敗は、どの理由でも同じ 1 種類の既知の失敗である", async () => {
    const owner = await createUser("owner");
    const outcomes = [
      await verifyAuthenticationResponseOf(await unregisteredResponse(), acceptAll),
      await verifyAuthenticationResponseOf(await otherKeyResponse(owner), acceptAll),
      await verifyAuthenticationResponseOf(await responseOf(owner, { userVerified: false }), acceptAll),
      await verifyAuthenticationResponseOf(
        await responseOf(owner, { origin: `https://${OTHER_HOST}` }),
        acceptAll,
      ),
      await verifyAuthenticationResponseOf(await responseOf(owner, { rpId: OTHER_HOST }), acceptAll),
      await verifyAuthenticationResponseOf(await responseOf(owner), () => false),
    ];
    expect(new Set(outcomes.map(expectRejected)).size).toBe(1);
  });
});

describe("パスキーの認証の options", () => {
  test("生体か PIN の確認を必須にし、credential を 1 つも指定せず、RP ID は auth ホストの host である", async () => {
    const options = await authenticationOptionsFor();
    expect(options.userVerification).toBe("required");
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.rpId).toBe(authHost().hostname);
  });
});

describe("credential の id での引き当てと、使った事実の記録", () => {
  afterEach(removeCreatedUsers);

  test("保存した credential の id で引くと、保存した user、credential の id、公開鍵、counter を持つ行が得られ、保存していない id では何も得られない", async () => {
    const owner = await createUser("owner");
    const { made } = signedRegistration({ algorithm: "ES256", challenge: CHALLENGE, userVerified: true });
    await savePasskey(owner, {
      credentialId: made.id,
      publicKey: made.publicKey,
      counter: 4,
      aaguid: made.aaguid,
      transports: made.transports,
    });

    expect(await passkeyFoundBy(made.id)).toEqual({
      userId: owner,
      credentialId: made.id,
      publicKey: made.publicKey,
      counter: 4,
    });
    const unsaved = signedRegistration({ algorithm: "ES256", challenge: CHALLENGE, userVerified: true });
    expect(await passkeyFoundBy(unsaved.made.id)).toBeUndefined();
  });

  test("使った事実を記録すると、そのパスキーの counter と最後に使った日時だけが変わり、同じ user の別のパスキーとほかの user のパスキーは変わらない", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const used = await savedCredential(owner, "ES256", 2);
    await savedCredential(owner, "ES256", 2);
    await savedCredential(other, "ES256", 2);
    const ownerBefore = await passkeysOf(owner);
    const otherBefore = await passkeysOf(other);

    const before = Date.now();
    await recordUse(used.credentialId, 9);
    const after = Date.now();

    const ownerAfter = await passkeysOf(owner);
    expect(ownerAfter).toEqual(
      ownerBefore.map((row) =>
        row.credentialId === used.credentialId
          ? { ...row, counter: 9, lastUsedAt: expect.any(Date) }
          : row,
      ),
    );
    const usedAfter = ownerAfter.find(({ credentialId }) => credentialId === used.credentialId);
    expect(usedAfter?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(usedAfter?.lastUsedAt?.getTime()).toBeLessThanOrEqual(after);
    expect(await passkeysOf(other)).toEqual(otherBefore);
  });

  test("counter が 0 のパスキーに counter 0 で使った事実を記録しても、最後に使った日時が更新される", async () => {
    const owner = await createUser("owner");
    const { credentialId } = await savedCredential(owner, "ES256", 0);

    const before = Date.now();
    await recordUse(credentialId, 0);
    const after = Date.now();

    const [row] = await passkeysOf(owner);
    expect(row?.counter).toBe(0);
    expect(row?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(before);
    expect(row?.lastUsedAt?.getTime()).toBeLessThanOrEqual(after);
  });
});
