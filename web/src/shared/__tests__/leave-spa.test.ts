import { afterEach, describe, expect, test } from "bun:test";

import { signInParamsSchema } from "@core/sign-in-params";

import {
  leaveSpaAfterAccountDeleted,
  leaveSpaTo,
  leaveSpaToSignIn,
  searchReturningTo,
  signInUrlAfterSignOut,
} from "../leave-spa";

const ORIGIN = "http://auth.taimei-code.local:3100";
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

const stubWindow = (path: { pathname: string; search?: string; hash?: string }) => {
  const replaced: string[] = [];
  globalThis.window = {
    location: {
      origin: ORIGIN,
      pathname: path.pathname,
      search: path.search ?? "",
      hash: path.hash ?? "",
      replace: (url: string) => {
        replaced.push(url);
      },
    },
  } as unknown as typeof globalThis.window;
  return replaced;
};

describe("leaveSpaTo", () => {
  test("履歴を積まずに document ごと移る", () => {
    const replaced = stubWindow({ pathname: "/auth/mfa" });

    leaveSpaTo("https://app.taimei-code.com/dashboard");

    expect(replaced).toEqual(["https://app.taimei-code.com/dashboard"]);
  });

  test("退会の後に取り直しが 401 を返しても、退会の後の遷移先を上書きしない", () => {
    const replaced = stubWindow({ pathname: "/account/companies" });

    leaveSpaAfterAccountDeleted();
    leaveSpaToSignIn();

    expect(replaced).toEqual([signInUrlAfterSignOut()]);
  });
});

describe("leaveSpaToSignIn", () => {
  test("末尾の / がある /auth/ へ移り、server の session-aware redirect を通す。戻り先は今の path・search・hash", () => {
    const replaced = stubWindow({
      pathname: "/account/members",
      search: "?redirect_target=x",
      hash: "#top",
    });

    leaveSpaToSignIn();

    expect(replaced).toHaveLength(1);
    const url = new URL(replaced[0] ?? "", ORIGIN);
    expect(url.pathname).toBe("/auth/");
    expect(url.searchParams.get("service_name")).toBe("accounts");
    expect(url.searchParams.get("redirect_url")).toBe(
      `${ORIGIN}/account/members?redirect_target=x#top`,
    );
  });
});

describe("signInUrlAfterSignOut", () => {
  test("末尾の / が無い /auth を返し、ログアウトの後に server の redirect を通らない", () => {
    stubWindow({ pathname: "/account" });

    const url = new URL(signInUrlAfterSignOut(), ORIGIN);

    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("service_name")).toBe("accounts");
    expect(url.searchParams.get("redirect_url")).toBe(`${ORIGIN}/account`);
  });

  test("遷移先の query は signInParamsSchema を通る (欠けると SignIn が invalid_redirect_url の画面へ移す)", () => {
    stubWindow({ pathname: "/account" });

    const url = new URL(signInUrlAfterSignOut(), ORIGIN);

    expect(signInParamsSchema.safeParse(Object.fromEntries(url.searchParams)).success).toBe(true);
  });
});

describe("searchReturningTo", () => {
  test("受諾画面の search はログイン後の redirect_url にそのまま残る", () => {
    stubWindow({ pathname: "/" });
    const href =
      "/auth/signup/accept-invitation?invitation_token=tok&service_name=taimei&redirect_url=https%3A%2F%2Fapp.taimei-code.com%2Fdashboard";

    const returnTo = new URL(searchReturningTo(href).redirect_url);

    expect(returnTo.origin).toBe(ORIGIN);
    expect(returnTo.pathname).toBe("/auth/signup/accept-invitation");
    expect(Object.fromEntries(returnTo.searchParams)).toEqual({
      invitation_token: "tok",
      service_name: "taimei",
      redirect_url: "https://app.taimei-code.com/dashboard",
    });
  });
});
