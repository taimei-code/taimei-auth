import { describe, expect, test } from "bun:test";

import { providerLabel } from "../provider-label";

describe("providerLabel", () => {
  test("github は正式表記 GitHub", () => {
    expect(providerLabel("github")).toBe("GitHub");
  });

  test("未知 provider は素の id を返す", () => {
    expect(providerLabel("gitlab")).toBe("gitlab");
  });
});
