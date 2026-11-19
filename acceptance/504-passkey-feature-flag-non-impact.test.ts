import { describe, expect, test } from "bun:test";
import { readRepoText } from "./harness/repo-text";

describe("用語集", () => {
  test("GLOSSARY.md にフィーチャーフラグの項がある", () => {
    expect(readRepoText("GLOSSARY.md")).toMatch(/^\*\*フィーチャーフラグ[^*]*\*\*:/m);
  });
});
