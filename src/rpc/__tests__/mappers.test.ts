import { describe, expect, test } from "bun:test";
import { toProtoAccount, toProtoSession, toProtoUser } from "../mappers";

describe("toProtoUser", () => {
  test("UserRow を proto User に変換し image: null と Date を正規化する", () => {
    const row = {
      id: "u-1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      image: null,
      revision: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-02T00:00:00Z"),
    };
    expect(toProtoUser(row)).toMatchObject({
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
      revision: 0,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(result.image).toBe("https://example.com/b.png");
  });

  test("ADR-001 R1: revision を proto に乗せる", () => {
    const result = toProtoUser({
      id: "u-3",
      name: "Carol",
      email: "carol@example.com",
      emailVerified: true,
      image: null,
      revision: 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.revision).toBe(7);
  });
});

describe("toProtoSession", () => {
  test("ADR-001 R7: sessionKind は現状 'user' 固定", () => {
    const result = toProtoSession({ id: "s-1", expiresAt: new Date("2026-12-31T00:00:00Z") });
    expect(result).toEqual({
      id: "s-1",
      expiresAt: "2026-12-31T00:00:00.000Z",
      sessionKind: "user",
    });
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
