import { afterEach, describe, expect, test } from "bun:test";
import { signInParamsSchema } from "@core/sign-in-params";
import { redirectAfterAuthChange } from "../auth-redirect";

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

const stubWindow = (origin: string) => {
  const stub = { location: { href: `${origin}/account`, origin } };
  globalThis.window = stub as unknown as typeof globalThis.window;
  return stub;
};

describe("redirectAfterAuthChange", () => {
  test("signOut は '/' へ full reload 遷移する (SessionGuard の再評価を強制)", () => {
    const stub = stubWindow("http://auth.taimei-code.local:3100");

    redirectAfterAuthChange("signOut");

    expect(stub.location.href).toBe("/");
  });

  test("deleteAccount は /auth (末尾スラッシュ無し) にログイン画面必須 params を付けて遷移する", () => {
    const stub = stubWindow("http://auth.taimei-code.local:3100");

    redirectAfterAuthChange("deleteAccount");

    const url = new URL(stub.location.href, "http://auth.taimei-code.local:3100");
    // 末尾スラッシュ付き /auth/ は auth-entry-redirect (AUTH_ENTRY_PATHS) の対象になり、
    // 削除直後の stale session (cookieCache 最大 5 分) が事業所作成画面へ誘導されてしまう
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("service_name")).toBe("accounts");
    expect(url.searchParams.get("redirect_url")).toBe("http://auth.taimei-code.local:3100/account");
  });

  test("deleteAccount の遷移先 query は signInParamsSchema を通る (欠落・不正だと SignIn が invalid_redirect_url エラー画面へ落とす)", () => {
    const stub = stubWindow("http://auth.taimei-code.local:3100");

    redirectAfterAuthChange("deleteAccount");

    const url = new URL(stub.location.href, "http://auth.taimei-code.local:3100");
    const parsed = signInParamsSchema.safeParse(Object.fromEntries(url.searchParams));
    expect(parsed.success).toBe(true);
  });
});
