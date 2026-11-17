import { describe, expect, test } from "bun:test";
import { readRepoText } from "./harness/repo-text";
import { stoppingLintCodes } from "./harness/lint-probe";
import {
  authHost,
  registrationOptionsFor,
  signedRegistration,
  type SignatureAlgorithm,
  type VerificationOutcome,
  verifyRegistrationResponseOf,
} from "./harness/passkey-registration";

const PACKAGE = "@simplewebauthn/server";
const VERSION = "14.1.0";
const CHALLENGE = "Y2hhbGxlbmdlLWZyb20tdGhlLW9wdGlvbnM";
const OTHER_HOST = "evil.example.net";
const CLIENT_ERROR = { min: 400, max: 499 };

const acceptAll = () => true;

const expectRejected = (outcome: VerificationOutcome) => {
  expect(outcome).toHaveProperty("rejected");
  if (!("rejected" in outcome)) return "";
  expect(outcome.rejected.status).toBeGreaterThanOrEqual(CLIENT_ERROR.min);
  expect(outcome.rejected.status).toBeLessThanOrEqual(CLIENT_ERROR.max);
  return outcome.rejected.tag;
};

const rejectedCases: ReadonlyArray<readonly [string, () => Promise<VerificationOutcome>]> = [
  [
    "生体か PIN の確認が無い ES256 の応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({ algorithm: "ES256", challenge: CHALLENGE, userVerified: false }).response,
        acceptAll,
      ),
  ],
  [
    "生体か PIN の確認が無い RS256 の応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({ algorithm: "RS256", challenge: CHALLENGE, userVerified: false }).response,
        acceptAll,
      ),
  ],
  [
    "auth ホストと違う origin の応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: CHALLENGE,
          userVerified: true,
          origin: `https://${OTHER_HOST}`,
        }).response,
        acceptAll,
      ),
  ],
  [
    "auth ホストの host と違う RP ID の応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: CHALLENGE,
          userVerified: true,
          rpId: OTHER_HOST,
        }).response,
        acceptAll,
      ),
  ],
  [
    "challenge の照合が偽を返した応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({ algorithm: "ES256", challenge: CHALLENGE, userVerified: true }).response,
        () => false,
      ),
  ],
  [
    "署名が合わない応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: CHALLENGE,
          userVerified: true,
          signatureMismatch: true,
        }).response,
        acceptAll,
      ),
  ],
  [
    "固定した方式の外の ML-DSA-44 の応答",
    () =>
      verifyRegistrationResponseOf(
        signedRegistration({ algorithm: "ML-DSA-44", challenge: CHALLENGE, userVerified: true }).response,
        acceptAll,
      ),
  ],
];

describe("依存の追加", () => {
  test(`${PACKAGE} が ${VERSION} に固定して dependencies に足され、bun.lock がその版を解決している`, () => {
    const manifest: { dependencies?: Record<string, string> } = JSON.parse(
      readRepoText("package.json"),
    );
    expect(manifest.dependencies?.[PACKAGE]).toBe(VERSION);
    expect(readRepoText("bun.lock")).toContain(`"${PACKAGE}@${VERSION}"`);
  });
});

describe("パスキーの登録の応答の検証", () => {
  const acceptedCase = (algorithm: SignatureAlgorithm) => async () => {
    const { response, made } = signedRegistration({ algorithm, challenge: CHALLENGE, userVerified: true });
    const seen: string[] = [];
    const outcome = await verifyRegistrationResponseOf(response, (challenge) => {
      seen.push(challenge);
      return true;
    });
    expect(outcome).toEqual({ accepted: made });
    expect(seen).toEqual([CHALLENGE]);
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
    for (const algorithm of ["ES256", "RS256"] as const) {
      expectRejected(
        await verifyRegistrationResponseOf(
          signedRegistration({ algorithm, challenge: CHALLENGE, userVerified: false }).response,
          acceptAll,
        ),
      );
    }
  });

  test("auth ホストと違う origin で作った応答は既知の失敗になる", async () => {
    expectRejected(
      await verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: CHALLENGE,
          userVerified: true,
          origin: `https://${OTHER_HOST}`,
        }).response,
        acceptAll,
      ),
    );
  });

  test("auth ホストの host と違う RP ID で作った応答は既知の失敗になる", async () => {
    expectRejected(
      await verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: CHALLENGE,
          userVerified: true,
          rpId: OTHER_HOST,
        }).response,
        acceptAll,
      ),
    );
  });

  test("challenge の照合が偽を返した応答は既知の失敗になる", async () => {
    expectRejected(
      await verifyRegistrationResponseOf(
        signedRegistration({ algorithm: "ES256", challenge: CHALLENGE, userVerified: true }).response,
        () => false,
      ),
    );
  });

  test("署名が合わない応答は既知の失敗になる", async () => {
    expectRejected(
      await verifyRegistrationResponseOf(
        signedRegistration({
          algorithm: "ES256",
          challenge: CHALLENGE,
          userVerified: true,
          signatureMismatch: true,
        }).response,
        acceptAll,
      ),
    );
  });

  test("正しく署名した ML-DSA-44 の応答は、検証する実行環境が ML-DSA-44 を扱えても既知の失敗になる", async () => {
    expectRejected(
      await verifyRegistrationResponseOf(
        signedRegistration({ algorithm: "ML-DSA-44", challenge: CHALLENGE, userVerified: true }).response,
        acceptAll,
      ),
    );
  });

  test("不正な応答の失敗は、どの理由でも同じ 1 種類の既知の失敗で、4xx の状態を持つ", async () => {
    const tags = new Set<string>();
    for (const [, run] of rejectedCases) {
      tags.add(expectRejected(await run()));
    }
    expect(tags.size).toBe(1);
  });
});

describe("パスキーの登録の options", () => {
  const user = { userId: "user-486-options", email: "passkey-owner@example.com" };

  test("生体か PIN の確認と discoverable credential を必須にし、user の名前にメールアドレスを持つ", async () => {
    const options = await registrationOptionsFor(user);
    expect(options.authenticatorSelection?.userVerification).toBe("required");
    expect(options.authenticatorSelection?.residentKey).toBe("required");
    expect(options.user.name).toBe(user.email);
  });

  test("RP ID は auth ホストの host で、受け付ける署名の方式は、実行環境が ML-DSA-44 を扱えても EdDSA、ES256、RS256 の 3 つ", async () => {
    const options = await registrationOptionsFor(user);
    expect(options.rp.id).toBe(authHost().hostname);
    expect(options.pubKeyCredParams.map(({ alg }) => alg).toSorted()).toEqual([-8, -7, -257].toSorted());
  });
});

describe("検証の library を import してよい場所", () => {
  const VALUE_IMPORT = `import { verifyRegistrationResponse } from "${PACKAGE}";\nexport const probe = verifyRegistrationResponse;`;
  const SUBPATH_IMPORT = `import { isoBase64URL } from "${PACKAGE}/helpers";\nexport const probe = isoBase64URL;`;
  const TYPE_IMPORT = `import type { RegistrationResponseJSON } from "${PACKAGE}";\nexport type Probe = RegistrationResponseJSON;`;

  const probes: ReadonlyArray<readonly [string, string, string]> = [
    ["src/passkey/zz-probe.ts", "値の import", VALUE_IMPORT],
    ["src/passkey/zz-probe.ts", "型の import", TYPE_IMPORT],
    ["src/passkey/zz-probe.ts", "subpath の値の import", SUBPATH_IMPORT],
    ["src/handlers/zz-probe.ts", "値の import", VALUE_IMPORT],
    ["src/handlers/zz-probe.ts", "型の import", TYPE_IMPORT],
    ["web/src/zz-probe.ts", "値の import", VALUE_IMPORT],
    ["src/passkey/__tests__/zz-probe.test.ts", "値の import", VALUE_IMPORT],
    ["src/passkey/__tests__/zz-probe.test.ts", "型の import", TYPE_IMPORT],
  ];

  for (const [path, kind, source] of probes) {
    test(`${path} に ${PACKAGE} の${kind} を書くと lint が止める`, () => {
      expect(stoppingLintCodes(path, source)).not.toEqual([]);
    });
  }
});
