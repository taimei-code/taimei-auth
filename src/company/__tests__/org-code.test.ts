import { describe, expect, test } from "bun:test";

import { orgCodeLabelJa, type OrgCode } from "../org-code";

describe("orgCodeLabelJa", () => {
  test("PERSONAL は個人事業主を返す", () => {
    const code: OrgCode = "PERSONAL";

    expect(orgCodeLabelJa(code)).toBe("個人事業主");
  });

  test("CORPORATE は法人を返す", () => {
    const code: OrgCode = "CORPORATE";

    expect(orgCodeLabelJa(code)).toBe("法人");
  });

  test("未知値は既存契約どおり法人へ倒す", () => {
    expect(orgCodeLabelJa("UNKNOWN")).toBe("法人");
  });
});
