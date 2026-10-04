import { describe, expect, test } from "bun:test";
import { Role as ProtoRole } from "../../gen/auth/v1/auth_pb";
import { toProtoRole, toProtoSession, toProtoUser } from "../mappers";

describe("toProtoUser", () => {
  test("UserRow を proto User に変換し image: null と Date を正規化する", () => {
    const row = {
      id: "u-1",
      name: "Alice",
      email: "alice@example.com",
      emailVerified: true,
      image: null,
      revision: 0,
      lastUsedCompanyId: null,
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
      defaultCompanyId: undefined,
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
      lastUsedCompanyId: null,
      createdAt: new Date("2026-03-01T00:00:00Z"),
      updatedAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(result.image).toBe("https://example.com/b.png");
  });

  test("revision を proto に乗せる", () => {
    const result = toProtoUser({
      id: "u-3",
      name: "Carol",
      email: "carol@example.com",
      emailVerified: true,
      image: null,
      revision: 7,
      lastUsedCompanyId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.revision).toBe(7);
  });

  test("lastUsedCompanyId が文字列なら defaultCompanyId proto field に流す", () => {
    const result = toProtoUser({
      id: "u-4",
      name: "Dave",
      email: "dave@example.com",
      emailVerified: true,
      image: null,
      revision: 0,
      lastUsedCompanyId: "cmp_abcdefghijklmnopqrstuvwx",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(result.defaultCompanyId).toBe("cmp_abcdefghijklmnopqrstuvwx");
  });
});

describe("toProtoRole", () => {
  test("membership.role の 3 値を proto の Role に写す", () => {
    expect([toProtoRole("OWNER"), toProtoRole("ADMIN"), toProtoRole("MEMBER")]).toEqual([
      ProtoRole.OWNER,
      ProtoRole.ADMIN,
      ProtoRole.MEMBER,
    ]);
  });
});

describe("toProtoSession", () => {
  test("sessionKind は現状 'user' 固定", () => {
    const result = toProtoSession({ id: "s-1", expiresAt: new Date("2026-12-31T00:00:00Z") });
    expect(result).toEqual({
      id: "s-1",
      expiresAt: "2026-12-31T00:00:00.000Z",
      sessionKind: "user",
    });
  });
});
