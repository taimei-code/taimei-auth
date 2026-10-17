import { describe, expect, test } from "bun:test";
import { isJustSignedUp, MAGIC_LINK_EXPIRES_IN_SECONDS, type SessionData } from "../../src/index";

const createdAt = "2026-01-01T00:00:00.000Z";
const data: SessionData = {
  user: {
    id: "u1",
    name: "n",
    email: "e",
    emailVerified: true,
    createdAt,
    updatedAt: createdAt,
  },
  session: { id: "s1", expiresAt: "", kind: "user" },
};
const windowEnd = Date.parse(createdAt) + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000;

describe("isJustSignedUp", () => {
  test("user を作ってから Magic Link の有効期限の内側なら登録の直後と判定する", () => {
    expect(isJustSignedUp(data, windowEnd - 1)).toBe(true);
  });

  test("Magic Link の有効期限を過ぎたら登録の直後と判定しない", () => {
    expect(isJustSignedUp(data, windowEnd)).toBe(false);
  });
});
