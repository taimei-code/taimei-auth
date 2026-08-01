import { afterEach, describe, expect, test } from "bun:test";
import { AUTH_REDIRECT_TARGETS, redirectAfterAuthChange } from "../auth-redirect";

// deleteAccount の "/auth" (末尾スラッシュ無し) は auth-entry-redirect の AUTH_ENTRY_PATHS
// 非対象で常に pass-through される前提の値。ここが "/auth/" 等へ変わると退会直後の
// redirect 挙動が変わるため、遷移先 2 値を pin する。

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

describe("AUTH_REDIRECT_TARGETS", () => {
  test("signOut は '/'、deleteAccount は '/auth' (末尾スラッシュ無し)", () => {
    expect(AUTH_REDIRECT_TARGETS).toEqual({ signOut: "/", deleteAccount: "/auth" });
  });
});

describe("redirectAfterAuthChange", () => {
  test("window.location.href に遷移先を代入する (full reload で SessionGuard の再評価を強制)", () => {
    const stub = { location: { href: "http://localhost/account" } };
    globalThis.window = stub as unknown as typeof globalThis.window;

    redirectAfterAuthChange("deleteAccount");
    expect(stub.location.href).toBe("/auth");

    redirectAfterAuthChange("signOut");
    expect(stub.location.href).toBe("/");
  });
});
