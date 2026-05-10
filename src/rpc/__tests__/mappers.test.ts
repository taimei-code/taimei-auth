import { describe, expect, test } from "bun:test";
import { toProtoAccount, toProtoUser } from "../mappers";

describe("toProtoUser", () => {
  test("UserRow を proto User に変換し image: null と Date を正規化する", () => {
    const row = {
      id: "u-1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      image: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };
    expect(toProtoUser(row)).toEqual({
      id: "u-1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      image: undefined,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  test("image が string ならそのまま流す", () => {
    const result = toProtoUser({
      id: "u-2",
      name: "Bob",
      email: "bob@example.com",
      emailVerified: false,
      image: "https://example.com/b.png",
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(result.image).toBe("https://example.com/b.png");
  });
});

describe("toProtoAccount", () => {
  test("AccountRow の nullable field を undefined に正規化", () => {
    const result = toProtoAccount({
      id: "a-1",
      accountId: "github-1",
      providerId: "github",
      userId: "u-1",
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result).toMatchObject({
      id: "a-1",
      accountId: "github-1",
      providerId: "github",
      userId: "u-1",
      accessToken: undefined,
      refreshToken: undefined,
      scope: undefined,
    });
  });
});
