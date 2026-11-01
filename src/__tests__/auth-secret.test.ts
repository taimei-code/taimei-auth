import { describe, expect, test } from "bun:test";
import { AUTH_SECRET_MIN_LENGTH, requireAuthSecret } from "../auth-secret";

describe("AUTH_SECRET が空なら起動しない (better-auth は NODE_ENV が production でない時、公開の既定の secret で黙って署名する。Workers には NODE_ENV が無い)", () => {
  test.each([undefined, ""])("AUTH_SECRET が %p なら、名前を含めて throw する", (value) => {
    expect(() => requireAuthSecret(value)).toThrow("AUTH_SECRET");
  });

  test("AUTH_SECRET が 32 文字以上なら、その値を返す", () => {
    const secret = "a".repeat(AUTH_SECRET_MIN_LENGTH);
    expect(requireAuthSecret(secret)).toBe(secret);
  });
});

describe("AUTH_SECRET が短ければ起動しない (推測しやすい鍵で session に署名させない)", () => {
  test("必要な長さは 32 文字", () => {
    expect(AUTH_SECRET_MIN_LENGTH).toBe(32);
  });

  test("31 文字なら、名前と必要な長さを含めて throw し、値は含めない", () => {
    const secret = "s".repeat(AUTH_SECRET_MIN_LENGTH - 1);
    expect(() => requireAuthSecret(secret)).toThrow(/AUTH_SECRET.*32/);
    expect(() => requireAuthSecret(secret)).not.toThrow(secret);
  });
});
