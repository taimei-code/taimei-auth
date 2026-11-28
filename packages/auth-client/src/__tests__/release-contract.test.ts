import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

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

  test("6.0.0 の CHANGELOG は、service key を SDK の file から読む移行の手順を持つ", () => {
    const section =
      /^## 6\.0\.0 [\s\S]*?(?=^## )/m.exec(readPackageFile("CHANGELOG.md"))?.[0] ?? "";

    expect(section).toMatch(/^### 移行$/m);
    expect(section).toContain("testing/service-key.env");
  });

  test("README の試験の環境の変数の表は TAIMEI_AUTH_SERVICE_KEY を持たず、service key を読む SDK の file を示す", () => {
    const readme = readPackageFile("README.md");

    expect(readme).not.toMatch(/^\| `TAIMEI_AUTH_SERVICE_KEY` \|/m);
    expect(readme).toContain("testing/service-key.env");
  });

  test("6.1.0 の CHANGELOG は、開発環境につなぐ上書きの file を示す", () => {
    const section =
      /^## 6\.1\.0 [\s\S]*?(?=^## )/m.exec(readPackageFile("CHANGELOG.md"))?.[0] ?? "";

    expect(section).toContain("testing/compose.development.yml");
  });

  test("README の開発環境につなぐ節は、上書きの file の path と、それが要る Docker Compose の版の下限を示す", () => {
    const section =
      /^### 開発環境につなぐ$[\s\S]*?(?=^##)/m.exec(readPackageFile("README.md"))?.[0] ?? "";

    expect(section).toContain("testing/compose.development.yml");
    expect(section).toMatch(/Docker Compose 2\.24/);
  });

  test("6.2.0 の CHANGELOG は、開発環境の固定の値の file を示す", () => {
    const section =
      /^## 6\.2\.0 [\s\S]*?(?=^## )/m.exec(readPackageFile("CHANGELOG.md"))?.[0] ?? "";

    expect(section).toContain("testing/development-environment.env");
  });

  test("README の開発環境につなぐ節は、固定の値の file と、その変数名と、TypeScript から file を読む関数を示す (consumer は README で、値を読む方法を知る)", () => {
    const section =
      /^### 開発環境につなぐ$[\s\S]*?(?=^##)/m.exec(readPackageFile("README.md"))?.[0] ?? "";

    expect(section).toContain("testing/development-environment.env");
    expect(section).toContain("parseEnv");
    for (const name of Object.keys(
      parseEnv(readPackageFile("testing/development-environment.env")),
    )) {
      expect(section).toContain(`\`${name}\``);
    }
  });

  test("6.2.1 の CHANGELOG は、断片が auth ホストの platform を指定したことを示す", () => {
    const section =
      /^## 6\.2\.1 [\s\S]*?(?=^## )/m.exec(readPackageFile("CHANGELOG.md"))?.[0] ?? "";

    expect(section).toContain("platform");
    expect(section).toContain("DOCKER_DEFAULT_PLATFORM");
  });

  test("README の arm64 の host の説明は、DOCKER_DEFAULT_PLATFORM が要るかどうかを示す (consumer は README で、arm64 の host の起動に足す設定を知る)", () => {
    expect(readPackageFile("README.md")).toMatch(/^- .*arm64.*DOCKER_DEFAULT_PLATFORM/m);
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
