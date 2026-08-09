import { describe, expect, test } from "bun:test";
import { auth } from "../../auth";

const registeredPluginIds = (): string[] =>
  ((auth.options.plugins ?? []) as unknown as { id: string }[]).map((plugin) => plugin.id);

describe("better-auth プラグインの登録順", () => {
  test("QA-M-08 magic-link → two-factor → mfa-challenge → sign-in-observer の順で登録されている", () => {
    expect(registeredPluginIds()).toEqual([
      "magic-link",
      "two-factor",
      "mfa-challenge",
      "sign-in-observer",
    ]);
  });

  test("QA-M-08 mfa-challenge は sign-in-observer より先 — 未通過セッションを記帳させない", () => {
    const ids = registeredPluginIds();

    expect(ids.indexOf("mfa-challenge")).toBeLessThan(ids.indexOf("sign-in-observer"));
    expect(ids.indexOf("mfa-challenge")).toBeGreaterThan(ids.indexOf("two-factor"));
  });
});
