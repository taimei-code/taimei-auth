import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dir, "../..");

const packageJson = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
  name: string;
  version: string;
  exports: Record<string, unknown>;
};

const readPackageFile = (name: string) => readFileSync(join(PACKAGE_ROOT, name), "utf8");

const firstChangelogVersion = (changelog: string): string | undefined =>
  /^## (\S+)/m.exec(changelog)?.[1];

const runtimeExportsOf = async (subpath: string): Promise<string[]> => {
  const specifier = subpath === "." ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`;
  return Object.keys(await import(specifier));
};

const CODE_IN_MARKDOWN = /```[\s\S]*?```|`[^`\n]+`/g;

const exportsMissingFrom = (readme: string, names: readonly string[]): string[] => {
  const code = (readme.match(CODE_IN_MARKDOWN) ?? []).join("\n");
  return [...new Set(names)].filter((name) => !new RegExp(`\\b${name}\\b`).test(code));
};

describe("SDK の版と、CHANGELOG・README の対応", () => {
  test("CHANGELOG の最初の版の見出しは package.json の version と同じ", () => {
    expect(firstChangelogVersion(readPackageFile("CHANGELOG.md"))).toBe(packageJson.version);
  });

  test("exports のすべての subpath の実行時の export は README に名前が出る (型だけの export は見ない)", async () => {
    const names = (
      await Promise.all(Object.keys(packageJson.exports).map(runtimeExportsOf))
    ).flat();

    expect(names.length).toBeGreaterThan(10);
    expect(exportsMissingFrom(readPackageFile("README.md"), names)).toEqual([]);
  });

  test("README の code の中に名前の無い export は、地の文に出ても漏れとして報告される", () => {
    expect(
      exportsMissingFrom("`createAuthClient(options)` と NEW_EXPORT", [
        "createAuthClient",
        "NEW_EXPORT",
      ]),
    ).toEqual(["NEW_EXPORT"]);
  });
});
