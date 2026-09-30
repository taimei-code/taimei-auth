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

describe("email の依存の封じ込め (静的 tripwire)", () => {
  test("起動時に prismjs を初期化する react-email の barrel / tailwind / code-block を import しない", () => {
    expect(
      grepFiles('"@react-email/(components|tailwind|code-block)"', "src", {
        excludeTests: true,
        include: ["*.ts", "*.tsx"],
      }),
    ).toEqual([]);
  });

  test("起動時に初期化される prismjs は、推移的な依存としても lockfile に入らない", () => {
    expect(grepFiles('"prismjs@', "bun.lock", { include: ["bun.lock"] })).toEqual([]);
  });
});

describe("email template の style の置き場所 (静的 tripwire)", () => {
  test("Tailwind が無いので className は CSS にならない。template は className を書かない", () => {
    expect(
      grepFiles("className=", "src/email", { excludeTests: true, include: ["*.tsx"] }),
    ).toEqual([]);
  });

  test("template 間で見た目を揃えるため、style は styles.ts の名前付き object だけを渡す", () => {
    expect(
      grepFiles("style=\\{\\{", "src/email", { excludeTests: true, include: ["*.tsx"] }),
    ).toEqual([]);
  });
});
