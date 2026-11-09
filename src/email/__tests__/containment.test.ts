import { describe, test } from "bun:test";
import { welcomeEmail } from "../welcome";

describe("email の DisplayText の封じ込め (静的 tripwire)", () => {
  test("raw string は DisplayText の props に渡せない", () => {
    // @ts-expect-error toDisplayText を通さない string は userName に取れない
    welcomeEmail({ appName: "x", userName: "raw", dashboardUrl: "u" });
  });
});
