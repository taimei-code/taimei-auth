import { describe, expect, test } from "bun:test";
import { grepFiles, SOURCE_ROOTS } from "../../__tests__/source-scan";

const outsideGuard = (pattern: string) =>
  SOURCE_ROOTS.flatMap((root) => grepFiles(pattern, root, { tests: "exclude" })).filter(
    (file) => !file.startsWith("src/membership/guard/"),
  );

describe("guard を通った印の封じ込め (静的 tripwire)", () => {
  test("Verified への cast は guard の中だけに書く", () => {
    expect(outsideGuard("as Verified")).toEqual([]);
  });

  test("印を付ける verified を呼ぶのは guard の中だけ", () => {
    expect(outsideGuard("(^|[^A-Za-z0-9_$])verified\\(")).toEqual([]);
  });
});
