import { describe, expect, test } from "bun:test";
import { decryptValue, encryptValue, parseMfaKeyRing } from "../cipher";

const keyOf = (version: number, seed: string): string =>
  `v${version}:${btoa(seed.repeat(32).slice(0, 32))}`;
const V1 = keyOf(1, "a");
const V2 = keyOf(2, "b");

const AAD = "user-cipher-1";
const plaintext = new TextEncoder().encode("attacker-must-not-read-this");

describe("parseMfaKeyRing", () => {
  test("AC-125 currentVersion は最大 version", () => {
    const ring = parseMfaKeyRing(`${V1},${V2}`);
    expect(ring.currentVersion).toBe(2);
    expect([...ring.keys.keys()].sort()).toEqual([1, 2]);
  });

  test.each([
    ["未設定", undefined],
    ["空文字", ""],
    ["v 無し", "1:AAAA"],
    ["非 base64", "v1:!!!!"],
    ["32byte 未満", `v1:${btoa("short")}`],
    ["version 0", `v0:${btoa("a".repeat(32))}`],
    ["重複 version", `${V1},${keyOf(1, "c")}`],
  ])("AC-127 不正な env (%s) は throw", (_name, raw) => {
    expect(() => parseMfaKeyRing(raw as string | undefined)).toThrow();
  });
});

describe("encryptValue / decryptValue", () => {
  test("AC-123 roundtrip 一致 (AAD = user_id)", async () => {
    const ring = parseMfaKeyRing(V1);
    const encrypted = await encryptValue(ring, plaintext, AAD);
    expect(encrypted.keyVersion).toBe(1);
    expect(await decryptValue(ring, encrypted, AAD)).toEqual(new Uint8Array(plaintext));
  });

  test("AC-124 AAD (user_id) 差し替えは reject", async () => {
    const ring = parseMfaKeyRing(V1);
    const encrypted = await encryptValue(ring, plaintext, AAD);
    await expect(decryptValue(ring, encrypted, "another-user")).rejects.toThrow();
  });

  test("AC-125 v1 暗号文を v1+v2 ring が復号し、新規暗号化は v2", async () => {
    const oldRing = parseMfaKeyRing(V1);
    const rotated = parseMfaKeyRing(`${V1},${V2}`);
    const legacy = await encryptValue(oldRing, plaintext, AAD);

    expect(await decryptValue(rotated, legacy, AAD)).toEqual(new Uint8Array(plaintext));
    expect((await encryptValue(rotated, plaintext, AAD)).keyVersion).toBe(2);
  });

  test("AC-126 ring に無い version は reject", async () => {
    const encrypted = await encryptValue(parseMfaKeyRing(V2.replace("v2", "v9")), plaintext, AAD);
    expect(encrypted.keyVersion).toBe(9);
    await expect(decryptValue(parseMfaKeyRing(`${V1},${V2}`), encrypted, AAD)).rejects.toThrow();
  });
});
