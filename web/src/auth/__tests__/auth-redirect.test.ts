import { afterEach, describe, expect, test } from "bun:test";

import { signInParamsSchema } from "@core/sign-in-params";
import { discardStaleSession, redirectAfterAuthChange, searchReturningTo } from "../auth-redirect";

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
  test("signOut は '/' へ full reload 遷移する (registry の事業所状態を捨てる)", () => {
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

describe("searchReturningTo", () => {
  test("AC-041 受諾画面の search はログイン後の redirect_url にそのまま残る", () => {
    const origin = "http://auth.taimei-code.local:3100";
    stubWindow(origin);
    const href =
      "/auth/signup/accept-invitation?invitation_token=tok&service_name=taimei&redirect_url=https%3A%2F%2Fapp.taimei-code.com%2Fdashboard";

    const returnTo = new URL(searchReturningTo(href).redirect_url);

    expect(returnTo.origin).toBe(origin);
    expect(returnTo.pathname).toBe("/auth/signup/accept-invitation");
    expect(Object.fromEntries(returnTo.searchParams)).toEqual({
      invitation_token: "tok",
      service_name: "taimei",
      redirect_url: "https://app.taimei-code.com/dashboard",
    });
  });
});
