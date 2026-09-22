export type MfaKeyRing = { currentVersion: number; keys: ReadonlyMap<number, Uint8Array> };

const KEY_ENTRY = /^v([1-9][0-9]*):([A-Za-z0-9+/]+={0,2})$/;
const KEY_BYTES = 32;

export function parseMfaKeyRing(raw: string | undefined): MfaKeyRing {
  if (!raw) throw new Error("MFA_TOTP_ENCRYPTION_KEYS is not set");
  const keys = new Map<number, Uint8Array>();
  for (const entry of raw.split(",")) {
    const match = KEY_ENTRY.exec(entry.trim());
    if (!match) throw new Error("MFA_TOTP_ENCRYPTION_KEYS: malformed key entry");
    const version = Number(match[1]);
    if (keys.has(version)) {
      throw new Error(`MFA_TOTP_ENCRYPTION_KEYS: duplicate key version ${version}`);
    }
    const key = decodeBase64(match[2]);
    if (key.length !== KEY_BYTES) {
      throw new Error(`MFA_TOTP_ENCRYPTION_KEYS: key v${version} is not ${KEY_BYTES} bytes`);
    }
    keys.set(version, key);
  }
  return { currentVersion: Math.max(...keys.keys()), keys };
}

export type EncryptedValue = { ciphertext: string; iv: string; keyVersion: number };

const AES_GCM = "AES-GCM";

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

// crypto.subtle の BufferSource は Uint8Array<ArrayBuffer> を要求する。
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

const importedKeys = new WeakMap<MfaKeyRing["keys"], Map<number, Promise<CryptoKey>>>();

function importAesKey(ring: MfaKeyRing, version: number): Promise<CryptoKey> {
  const key = ring.keys.get(version);
  if (!key) throw new Error(`mfa cipher: key version ${version} is not in the ring`);
  let cache = importedKeys.get(ring.keys);
  if (!cache) {
    cache = new Map();
    importedKeys.set(ring.keys, cache);
  }
  let imported = cache.get(version);
  if (!imported) {
    imported = crypto.subtle.importKey("raw", asBufferSource(key), AES_GCM, false, [
      "encrypt",
      "decrypt",
    ]);
    cache.set(version, imported);
  }
  return imported;
}

export async function encryptValue(
  ring: MfaKeyRing,
  plaintext: Uint8Array,
  aad: string,
): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importAesKey(ring, ring.currentVersion);
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES_GCM, iv, additionalData: ENCODER.encode(aad) },
    key,
    asBufferSource(plaintext),
  );
  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    iv: encodeBase64(iv),
    keyVersion: ring.currentVersion,
  };
}

export async function decryptValue(
  ring: MfaKeyRing,
  value: EncryptedValue,
  aad: string,
): Promise<Uint8Array> {
  const key = await importAesKey(ring, value.keyVersion);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: AES_GCM,
      iv: decodeBase64(value.iv),
      additionalData: ENCODER.encode(aad),
    },
    key,
    decodeBase64(value.ciphertext),
  );
  return new Uint8Array(plaintext);
}

// Buffer は Bun と workerd (nodejs_compat) の両方にある。
function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(text, "base64"));
}

export const secretCipher = (row: {
  secretCiphertext: string;
  secretIv: string;
  keyVersion: number;
}): EncryptedValue => ({
  ciphertext: row.secretCiphertext,
  iv: row.secretIv,
  keyVersion: row.keyVersion,
});

export const codeCipher = (row: {
  codeCiphertext: string;
  codeIv: string;
  keyVersion: number;
}): EncryptedValue => ({
  ciphertext: row.codeCiphertext,
  iv: row.codeIv,
  keyVersion: row.keyVersion,
});

export async function decryptText(
  ring: MfaKeyRing,
  value: EncryptedValue,
  aad: string,
): Promise<string> {
  return DECODER.decode(await decryptValue(ring, value, aad));
}
