import { describe, expect, test } from "bun:test";
import { grepFiles } from "../../__tests__/source-scan";
import { welcomeEmail } from "../welcome";

describe("email の DisplayText の封じ込め (静的 tripwire)", () => {
  test("DisplayText への cast は sanitize.ts の toDisplayText だけ", () => {
    expect(
      grepFiles("as DisplayText", "src", {
        tests: "exclude",
      }),
    ).toEqual(["src/email/sanitize.ts"]);
  });

  test("raw string は DisplayText の props に渡せない", () => {
    // @ts-expect-error toDisplayText を通さない string は userName に取れない
    welcomeEmail({ appName: "x", userName: "raw", dashboardUrl: "u" });
  });
});
