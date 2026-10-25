import { afterEach, describe, expect, test } from "bun:test";

import type { RouteEntry } from "../../shared/route-entry";
import { redirectFor } from "../route-redirect";

const ORIGIN = "http://auth.taimei-code.localhost:3100";
const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

const stubOrigin = () => {
  globalThis.window = { location: { origin: ORIGIN } } as unknown as typeof globalThis.window;
};

describe("入口の判定から redirect への写しは redirectFor の 1 つだけ", () => {
  test("signIn は今の URL を戻り先にして /auth/ へ document ごと移る", () => {
    stubOrigin();

    const { options } = redirectFor({ kind: "signIn" }, "/account/members");

    expect(options).toMatchObject({
      to: "/auth/",
      search: { service_name: "accounts", redirect_url: `${ORIGIN}/account/members` },
      reloadDocument: true,
      replace: true,
    });
  });

  test("goToRedirectUrl はその URL へ document ごと移る", () => {
    const { options } = redirectFor(
      { kind: "goToRedirectUrl", redirectUrl: "https://app.taimei-code.com/dashboard" },
      "/auth/signup/company",
    );

    expect(options).toMatchObject({
      href: "https://app.taimei-code.com/dashboard",
      reloadDocument: true,
    });
  });

  test("companySignup は今の URL を戻り先にして事業所登録へ移る", () => {
    stubOrigin();

    const { options } = redirectFor({ kind: "companySignup" }, "/account");

    expect(options).toMatchObject({
      to: "/auth/signup/company",
      search: { redirect_url: `${ORIGIN}/account` },
      reloadDocument: true,
    });
  });

  test("show と failed は redirect に写せない (型で止める)", () => {
    const show: RouteEntry = { kind: "show" };
    const failed: RouteEntry = { kind: "failed", message: "x" };

    // @ts-expect-error show は画面を出すので redirect にしない
    expect(() => redirectFor(show, "/account")).not.toThrow();
    // @ts-expect-error failed は画面に文言を出すので redirect にしない
    expect(() => redirectFor(failed, "/account")).not.toThrow();
  });
});
