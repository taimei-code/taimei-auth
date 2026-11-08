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
  test("companySignup は今の URL を戻り先にして事業所登録へ移る", () => {
    stubOrigin();

    const { options } = redirectFor({ kind: "companySignup" }, "/account");

    expect(options).toMatchObject({
      href: `/auth/signup/company?service_name=accounts&redirect_url=${encodeURIComponent(`${ORIGIN}/account`)}`,
      reloadDocument: true,
      replace: true,
    });
  });

  test("show は redirect に写せない (型で止める)", () => {
    const show: RouteEntry = { kind: "show" };

    // @ts-expect-error show は画面を出すので redirect にしない
    expect(() => redirectFor(show, "/account")).not.toThrow();
  });
});
