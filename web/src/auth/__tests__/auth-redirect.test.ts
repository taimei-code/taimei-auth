import { afterEach, describe, expect, test } from "bun:test";
import { signInParamsSchema } from "@core/sign-in-params";
import { RequestJsonError } from "../../shared/request-json";
import {
  discardStaleSession,
  isStaleSessionError,
  redirectAfterAuthChange,
} from "../auth-redirect";

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

describe("isStaleSessionError", () => {
  test("account API の 401 は stale session (session cookie は有効なのに server guard が拒否) と判定する", () => {
    expect(
      isStaleSessionError(new RequestJsonError(401, "GET /api/account/memberships failed: 401")),
    ).toBe(true);
  });

  test("401 以外の RequestJsonError や一般 Error は stale session ではない", () => {
    expect(isStaleSessionError(new RequestJsonError(403, "forbidden"))).toBe(false);
    expect(isStaleSessionError(new RequestJsonError(500, "boom"))).toBe(false);
    expect(isStaleSessionError(new Error("network"))).toBe(false);
  });
});

describe("discardStaleSession", () => {
  const stubReplaceableWindow = (origin: string) => {
    const replaced: string[] = [];
    const stub = {
      location: {
        href: `${origin}/auth/signup/company`,
        origin,
        replace: (url: string) => {
          replaced.push(url);
        },
      },
    };
    globalThis.window = stub as unknown as typeof globalThis.window;
    return replaced;
  };

  test("signOut を完了してから /auth (末尾スラッシュ無し) の sign-in landing へ replace 遷移する", async () => {
    const replaced = stubReplaceableWindow("http://auth.taimei-code.local:3100");
    const order: string[] = [];

    await discardStaleSession(async () => {
      order.push("signOut");
    });

    expect(order).toEqual(["signOut"]);
    expect(replaced).toHaveLength(1);
    const url = new URL(replaced[0] ?? "", "http://auth.taimei-code.local:3100");
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("service_name")).toBe("accounts");
    expect(url.searchParams.get("redirect_url")).toBe("http://auth.taimei-code.local:3100/account");
  });

  test("signOut が失敗しても sign-in landing へ遷移する (画面に留めない)", async () => {
    const replaced = stubReplaceableWindow("http://auth.taimei-code.local:3100");

    await discardStaleSession(async () => {
      throw new Error("sign-out failed");
    });

    expect(replaced).toHaveLength(1);
  });
});
