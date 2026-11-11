import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Schema } from "effect";

import { readPackageJson, REPO_ROOT } from "./config-invariant-helpers";
import { repoFiles } from "./source-scan";

const SKILL_VERSION = /^---\n(?:.*\n)*?  foldkit-version: (\S+)\n(?:.*\n)*?---\n/;
const FOLDKIT_SKILLS = ["foldkit", "generate-program", "audit-program"] as const;

const readRepoFile = (file: string) => readFileSync(path.join(REPO_ROOT, file), "utf8");

const devDependencies = readPackageJson().devDependencies ?? {};
const installedFoldkitVersion = devDependencies.foldkit ?? "";

const PackageVersion = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));
const subtreePackageVersion = (packageDir: string) =>
  Schema.decodeSync(PackageVersion)(
    readRepoFile(`repos/foldkit/packages/${packageDir}/package.json`),
  ).version;

const SkillsLock = Schema.fromJsonString(
  Schema.Struct({ version: Schema.String, sha256: Schema.String }),
);

const skillsLock = Schema.decodeSync(SkillsLock)(
  readRepoFile(".claude/skills/foldkit-skills.lock.json"),
);

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

const skillFiles = () =>
  FOLDKIT_SKILLS.flatMap((skill) =>
    readdirSync(path.join(REPO_ROOT, ".claude/skills", skill), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        path.relative(REPO_ROOT, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
      ),
  ).sort();

const skillsSha256 = () =>
  sha256(
    skillFiles()
      .map((file) => `${sha256(readRepoFile(file))}  ${file}\n`)
      .join(""),
  );

const SKILL_DIR_REFERENCE = /\$\{CLAUDE_SKILL_DIR\}\/([\w./@-]+)/g;

const pathsReferencedFromSkillDir = () =>
  skillFiles()
    .filter((file) => file.endsWith(".md"))
    .flatMap((file) =>
      [...readRepoFile(file).matchAll(SKILL_DIR_REFERENCE)].map(([, referenced = ""]) =>
        path.join(path.dirname(file), referenced.replace(/\.+$/, "")),
      ),
    );

const AgentSettings = Schema.fromJsonString(
  Schema.Struct({
    claudeMdExcludes: Schema.Array(Schema.String),
    skillOverrides: Schema.Record(Schema.String, Schema.String),
  }),
);

const agentSettings = Schema.decodeSync(AgentSettings)(readRepoFile(".claude/settings.json"));

const upstreamSkillNames = () =>
  repoFiles(":(glob)repos/**/.claude/skills/*/SKILL.md").map((file) =>
    path.basename(path.dirname(file)),
  );

const upstreamInstructionDocuments = () =>
  repoFiles(":(glob)repos/**/CLAUDE.md", ":(glob)repos/**/AGENTS.md");

const isExcludedFromAutoLoad = (file: string) =>
  agentSettings.claudeMdExcludes.some((glob) =>
    new Bun.Glob(glob).match(path.join(REPO_ROOT, file)),
  );

describe("agent が読む Foldkit の参照は、入れた版と一致する", () => {
  test("package.json の foldkit は範囲を持たない版で固定する", () => {
    expect(installedFoldkitVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test.each([
    ["foldkit", "foldkit"],
    ["@foldkit/ui", "ui"],
  ])("repos/foldkit の subtree の %s は、入れた版と一致する", (packageName, packageDir) => {
    expect(subtreePackageVersion(packageDir)).toBe(devDependencies[packageName] ?? "");
  });

  test("web/src/CLAUDE.md は Foldkit の版を書かない (版は package.json と subtree だけが持つ)", () => {
    expect(readRepoFile("web/src/CLAUDE.md")).not.toMatch(/foldkit@\d/);
  });

  test.each([
    ...FOLDKIT_SKILLS,
  ])(".claude/skills/%s は入れた版の tag から写した skill である", (skill) => {
    expect(readRepoFile(`.claude/skills/${skill}/SKILL.md`).match(SKILL_VERSION)?.[1]).toBe(
      installedFoldkitVersion,
    );
  });

  test("skill を取り直した版は、入れた版と一致する", () => {
    expect(skillsLock.version).toBe(installedFoldkitVersion);
  });

  test("skill の中身は scripts/update-foldkit-reference.sh が取り直したときの hash と一致する (手で写したり書き換えたりすると落ちる)", () => {
    expect(skillsSha256()).toBe(skillsLock.sha256);
  });

  test.each([
    "FOLDKIT.md",
    "web/FOLDKIT.md",
    "web/.mcp.json",
  ])("Foldkit の scaffold が置く %s を repo に持ち込まない", (file) => {
    expect(existsSync(path.join(REPO_ROOT, file))).toBe(false);
  });

  test("repo の .mcp.json に Foldkit の DevTools の MCP server を足さない", () => {
    expect(readRepoFile(".mcp.json")).not.toMatch(/foldkit/i);
  });
});

describe("写した Foldkit の repo は、この repo の agent の設定と噛み合う", () => {
  test("写した skill が自分の dir から指す path は、どれも在る (無い dir を指したら .claude/ に repos/foldkit への symlink を足す)", () => {
    const referenced = pathsReferencedFromSkillDir();
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter((file) => !existsSync(path.join(REPO_ROOT, file)))).toEqual([]);
  });

  test("repos/ の下の .claude/skills が持つ上流の skill は、どれも .claude/settings.json の skillOverrides で off にする (上流の repo を保守するための skill で、この repo の作業には使わない)", () => {
    const upstream = upstreamSkillNames();
    expect(upstream.length).toBeGreaterThan(0);
    expect(upstream.filter((name) => agentSettings.skillOverrides[name] !== "off")).toEqual([]);
  });

  test("repos/ の下の CLAUDE.md と AGENTS.md は、どれも .claude/settings.json の claudeMdExcludes で自動の読み込みから外す (上流の文書は、この repo に無い dir で Effect を調べさせる)", () => {
    const documents = upstreamInstructionDocuments();
    expect(documents.length).toBeGreaterThan(0);
    expect(documents.filter((file) => !isExcludedFromAutoLoad(file))).toEqual([]);
  });
});
