import { Schema } from "effect";

const Claims = Schema.Struct({
  sub: Schema.String,
  email: Schema.String,
  companyId: Schema.NullOr(Schema.String),
  role: Schema.NullOr(Schema.Literals(["OWNER", "ADMIN", "MEMBER"])),
  revision: Schema.Number,
  exp: Schema.Number,
});

const decodeClaims = Schema.decodeUnknownSync(Claims);

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

let keys: CryptoKeyPair | undefined;

const keyPair = async () => {
  keys ??= (await crypto.subtle.generateKey(ALG, false, ["sign", "verify"])) as CryptoKeyPair;
  return keys;
};

export const issue = async (claims: typeof Claims.Type) => {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", typ: "JWT" })));
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(SIGN, (await keyPair()).privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
};

export const verify = async (token: string, nowSeconds: number) => {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return { ok: false as const, reason: "malformed" };
  const valid = await crypto.subtle.verify(SIGN, (await keyPair()).publicKey, fromB64url(signature), new TextEncoder().encode(`${header}.${payload}`));
  if (!valid) return { ok: false as const, reason: "signature" };
  const claims = decodeClaims(JSON.parse(new TextDecoder().decode(fromB64url(payload))));
  if (claims.exp < nowSeconds) return { ok: false as const, reason: "expired" };
  return { ok: true as const, claims };
};
