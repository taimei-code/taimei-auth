import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { Effect } from "effect";
import { parseClientFacingError } from "../../src/handlers/client-facing-error";

type CborValue = number | string | Uint8Array | ReadonlyMap<CborValue, CborValue>;

const concat = (...parts: readonly Uint8Array[]): Uint8Array => new Uint8Array(Buffer.concat(parts));

const cborHead = (major: number, length: number): Uint8Array => {
  if (length < 24) return Uint8Array.of((major << 5) | length);
  if (length < 0x100) return Uint8Array.of((major << 5) | 24, length);
  if (length < 0x10000) return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
  return Uint8Array.of(
    (major << 5) | 26,
    length >>> 24,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  );
};

const cbor = (value: CborValue): Uint8Array => {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    return concat(cborHead(3, bytes.length), bytes);
  }
  if (value instanceof Uint8Array) return concat(cborHead(2, value.length), value);
  return concat(cborHead(5, value.size), ...[...value].flatMap(([key, entry]) => [cbor(key), cbor(entry)]));
};

const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

const sha256 = (bytes: Uint8Array | string): Uint8Array =>
  new Uint8Array(createHash("sha256").update(bytes).digest());

const aaguidText = (bytes: Uint8Array) => {
  const hex = Buffer.from(bytes).toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
};

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

export type SignatureAlgorithm = "ES256" | "RS256" | "ML-DSA-44";

const COSE_ALGORITHM: Readonly<Record<SignatureAlgorithm, number>> = {
  ES256: -7,
  RS256: -257,
  "ML-DSA-44": -48,
};

const keyPairOf = (algorithm: SignatureAlgorithm) => {
  if (algorithm === "ES256") return generateKeyPairSync("ec", { namedCurve: "P-256" });
  if (algorithm === "RS256") return generateKeyPairSync("rsa", { modulusLength: 2048 });
  return generateKeyPairSync("ml-dsa-44");
};

const coseKeyOf = (algorithm: SignatureAlgorithm, jwk: JsonWebKey): Uint8Array => {
  const bytes = (field: string | undefined) => new Uint8Array(Buffer.from(field ?? "", "base64url"));
  if (algorithm === "ES256") {
    return cbor(
      new Map<CborValue, CborValue>([
        [1, 2],
        [3, COSE_ALGORITHM.ES256],
        [-1, 1],
        [-2, bytes(jwk.x)],
        [-3, bytes(jwk.y)],
      ]),
    );
  }
  if (algorithm === "RS256") {
    return cbor(
      new Map<CborValue, CborValue>([
        [1, 3],
        [3, COSE_ALGORITHM.RS256],
        [-1, bytes(jwk.n)],
        [-2, bytes(jwk.e)],
      ]),
    );
  }
  return cbor(
    new Map<CborValue, CborValue>([
      [1, 7],
      [3, COSE_ALGORITHM["ML-DSA-44"]],
      [-1, bytes((jwk as JsonWebKey & { readonly pub?: string }).pub)],
    ]),
  );
};

const TRANSPORTS = ["internal", "hybrid"] as const;

export const authHost = () => new URL(process.env.AUTH_SERVICE_URL ?? "");

export const signedRegistration = (input: {
  readonly algorithm: SignatureAlgorithm;
  readonly challenge: string;
  readonly userVerified: boolean;
  readonly origin?: string;
  readonly rpId?: string;
  readonly signatureMismatch?: true;
}) => {
  const credentialId = new Uint8Array(randomBytes(16));
  const aaguid = new Uint8Array(randomBytes(16));
  const { publicKey, privateKey } = keyPairOf(input.algorithm);
  const coseKey = coseKeyOf(input.algorithm, publicKey.export({ format: "jwk" }));
  const flags =
    FLAG_USER_PRESENT | FLAG_ATTESTED_CREDENTIAL | (input.userVerified ? FLAG_USER_VERIFIED : 0);
  const authData = concat(
    sha256(input.rpId ?? authHost().hostname),
    Uint8Array.of(flags),
    Uint8Array.of(0, 0, 0, 0),
    aaguid,
    Uint8Array.of(credentialId.length >> 8, credentialId.length & 0xff),
    credentialId,
    coseKey,
  );
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({
      type: "webauthn.create",
      challenge: input.challenge,
      origin: input.origin ?? authHost().origin,
      crossOrigin: false,
    }),
  );
  const signedClientData = input.signatureMismatch === true ? "{}" : clientDataJSON;
  const signedData = concat(authData, sha256(signedClientData));
  const signature = new Uint8Array(
    sign(input.algorithm === "ML-DSA-44" ? null : "sha256", signedData, privateKey),
  );
  const attestationObject = cbor(
    new Map<CborValue, CborValue>([
      ["fmt", "packed"],
      [
        "attStmt",
        new Map<CborValue, CborValue>([
          ["alg", COSE_ALGORITHM[input.algorithm]],
          ["sig", signature],
        ]),
      ],
      ["authData", authData],
    ]),
  );
  return {
    response: {
      id: base64url(credentialId),
      rawId: base64url(credentialId),
      type: "public-key" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(attestationObject),
        transports: [...TRANSPORTS],
      },
    },
    made: {
      id: base64url(credentialId),
      publicKey: coseKey,
      counter: 0,
      aaguid: aaguidText(aaguid),
      transports: [...TRANSPORTS],
    },
  };
};

export type VerificationOutcome =
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

export const verifyRegistrationResponseOf = async (
  response: ReturnType<typeof signedRegistration>["response"],
  matchesChallenge: (challenge: string) => boolean,
): Promise<VerificationOutcome> => {
  const { verifyRegistration } = await import("../../src/passkey/webauthn");
  return Effect.runPromise(
    verifyRegistration({
      response,
      matchesChallenge: (challenge: string) => Effect.sync(() => matchesChallenge(challenge)),
    }).pipe(
      Effect.map(
        (passkey): VerificationOutcome => ({
          accepted: {
            id: passkey.id,
            publicKey: new Uint8Array(passkey.publicKey),
            counter: passkey.counter,
            aaguid: passkey.aaguid,
            transports: passkey.transports,
          },
        }),
      ),
      Effect.catch((failure) => {
        const clientFacing = parseClientFacingError(failure);
        return Effect.succeed<VerificationOutcome>({
          rejected: { tag: clientFacing?.tag ?? "", status: clientFacing?.status ?? 0 },
        });
      }),
    ),
  );
};

export const registrationOptionsFor = async (user: { readonly userId: string; readonly email: string }) => {
  const { registrationOptions } = await import("../../src/passkey/webauthn");
  return Effect.runPromise(registrationOptions(user));
};
