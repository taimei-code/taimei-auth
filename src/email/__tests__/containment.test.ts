import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../__tests__/grep-files";
import WelcomeEmail from "../welcome";

describe("email の DisplayText の封じ込め (静的 tripwire)", () => {
  test("DisplayText への cast は sanitize.ts の toDisplayText だけ", () => {
    expect(
      grepFiles("as DisplayText", "src", {
        excludeTests: true,
        include: ["*.ts", "*.tsx"],
      }),
    ).toEqual(["src/email/sanitize.ts"]);
  });

  test("raw string は DisplayText の props に渡せない", () => {
    // @ts-expect-error toDisplayText を通さない string は userName に取れない
    WelcomeEmail({ appName: "x", userName: "raw", dashboardUrl: "u" });
  });
});
