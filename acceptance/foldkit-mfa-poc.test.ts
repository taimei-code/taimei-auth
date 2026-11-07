import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const POC_DOCUMENT = join(
  homedir(),
  ".claude/plans/taimei/poc/2026-11-06-foldkit-mfa-enroll/poc.md",
);
const DESIGN_ROOT = join(homedir(), ".claude/plans/design");
const MAIN_BEFORE_POC = "8fa500c";
const QUESTIONS = ["Q2", "Q3", "Q5", "Q6", "Q7"] as const;
const STAGES = new Set(["S", "T", "L", "X", "D"]);

const git = (...args: string[]) => spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });

const pocDocument = (): string => readFileSync(POC_DOCUMENT, "utf8");

const section = (markdown: string, heading: string): string => {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`poc.md に「## ${heading}」が無い`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
};

const subsections = (body: string): { heading: string; text: string }[] =>
  body
    .split(/^### /m)
    .slice(1)
    .map((chunk) => {
      const [heading = "", ...text] = chunk.split("\n");
      return { heading, text: text.join("\n") };
    });

const tableCells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const ledgerTable = () => {
  const rows = section(pocDocument(), "台帳")
    .split("\n")
    .filter((line) => line.trim().startsWith("|"));
  const [header = "", , ...body] = rows;
  return { header: tableCells(header), body: body.map(tableCells) };
};

const sourceFilesUnder = (directory: string): string[] =>
  readdirSync(join(REPO_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFilesUnder(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });

const foldkitFilesInMfa = (): string[] =>
  sourceFilesUnder("web/src/mfa").filter((file) =>
    /from\s+["']foldkit(?:\/[^"']*)?["']/.test(readFileSync(join(REPO_ROOT, file), "utf8")),
  );

const installedVersion = (name: string): string | null => {
  const manifest = join(REPO_ROOT, "node_modules", name, "package.json");
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : null;
};

const rootDependencies = (): Record<string, string> => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  return { ...manifest.dependencies, ...manifest.devDependencies };
};

describe("PoC の文書が問いと台帳に答えている", () => {
  test("AC-001: 星取表に Q2・Q3・Q5・Q6・Q7 の見出しがあり、それぞれに観測の印がある", () => {
    const tables = subsections(section(pocDocument(), "星取表"));
    for (const question of QUESTIONS) {
      const matching = tables.filter(({ heading }) => heading.includes(question));
      expect(matching.length, `${question} の見出し`).toBeGreaterThan(0);
      expect(
        matching.some(({ text }) => /[○△×]/.test(text)),
        `${question} の観測の印`,
      ).toBe(true);
    }
  });

  test("AC-002: 結論が Q2・Q3・Q5・Q6・Q7 のそれぞれを名指しして答えている", () => {
    const conclusion = section(pocDocument(), "結論");
    for (const question of QUESTIONS) {
      expect(conclusion, question).toContain(question);
    }
  });

  test("AC-003: 台帳に 1〜54 の規則の行があり、各行に Foldkit での段がある", () => {
    const { header, body } = ledgerTable();
    const stageColumn = header.findIndex((cell) => cell.includes("Foldkit"));
    expect(stageColumn, "Foldkit での段の列").toBeGreaterThanOrEqual(0);
    const numbered = new Map(body.map((cells) => [cells[0] ?? "", cells]));
    for (let rule = 1; rule <= 54; rule++) {
      const cells = numbered.get(String(rule));
      expect(cells, `規則 ${rule} の行`).toBeDefined();
      expect(STAGES.has((cells ?? [])[stageColumn] ?? ""), `規則 ${rule} の段`).toBe(true);
    }
  });

  test("AC-004: 台帳に、確かめられない理由と見込みの段が別の欄としてある", () => {
    const { header } = ledgerTable();
    const reasonColumn = header.findIndex((cell) => cell.includes("理由"));
    const expectedColumn = header.findIndex((cell) => cell.includes("見込み"));
    expect(reasonColumn).toBeGreaterThanOrEqual(0);
    expect(expectedColumn).toBeGreaterThanOrEqual(0);
    expect(reasonColumn).not.toBe(expectedColumn);
  });

  test("AC-005: G1〜G3 の見込みに、G1 の割合と G2・G3 の件数がある", () => {
    const estimate = section(pocDocument(), "G1〜G3 の見込み");
    expect(estimate).toMatch(/G1[^\n]*?\d+(?:\.\d+)?\s*%/);
    expect(estimate).toMatch(/G2[^\n]*?\d+\s*件/);
    expect(estimate).toMatch(/G3[^\n]*?\d+\s*件/);
  });

  test("AC-006: 撤退の条件が G1・Q3・Q6 を名指しして、当たるかを書いている", () => {
    const withdrawal = section(pocDocument(), "撤退の条件");
    for (const subject of ["G1", "Q3", "Q6"]) {
      expect(withdrawal, subject).toContain(subject);
    }
    expect(withdrawal).toMatch(/当たる|当たらない/);
  });
});

describe("Foldkit の package と lint", () => {
  test("AC-007: 決められた版の Foldkit の package が入り、root の package.json に書かれている", () => {
    expect(installedVersion("foldkit")).toBe("0.170.0");
    expect(installedVersion("@foldkit/ui")).toBe("0.170.0");
    expect(installedVersion("@effect/platform-browser")).toBe("4.1.2");
    expect(installedVersion("@foldkit/oxlint-plugin")).not.toBeNull();
    const dependencies = rootDependencies();
    for (const name of [
      "foldkit",
      "@foldkit/ui",
      "@foldkit/oxlint-plugin",
      "@effect/platform-browser",
    ]) {
      expect(dependencies[name], name).toBeDefined();
    }
  });

  test("AC-008: MFA の Foldkit の code に recommended が禁じる書き方を足すと、foldkit の rule が error を出す", () => {
    const [target] = foldkitFilesInMfa();
    expect(target, "web/src/mfa の foldkit を import する file").toBeDefined();
    const workspace = mkdtempSync(join(tmpdir(), "foldkit-lint-probe-"));
    try {
      cpSync(join(REPO_ROOT, ".oxlintrc.json"), join(workspace, ".oxlintrc.json"));
      symlinkSync(join(REPO_ROOT, "node_modules"), join(workspace, "node_modules"));
      const copied = join(workspace, target ?? "");
      mkdirSync(dirname(copied), { recursive: true });
      writeFileSync(
        copied,
        `${readFileSync(join(REPO_ROOT, target ?? ""), "utf8")}\nexport let acceptanceProbeState = 0;\n`,
      );
      const lint = spawnSync(
        join(REPO_ROOT, "node_modules/.bin/oxlint"),
        ["-c", ".oxlintrc.json", relative(workspace, copied)],
        { cwd: workspace, encoding: "utf8" },
      );
      expect(lint.status).not.toBe(0);
      expect(`${lint.stdout}${lint.stderr}`).toMatch(/foldkit[(/]no-module-level-mutable-state/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe("MFA の有効化の画面", () => {
  test("AC-009: 有効化の画面は Radix の Dialog を import しない", () => {
    const source = readFileSync(join(REPO_ROOT, "web/src/mfa/MfaEnrollDialog.tsx"), "utf8");
    expect(source).not.toMatch(/shared\/ui\/dialog|@radix-ui\/react-dialog/);
  });

  test("AC-011: MFA と Unauthorized の e2e は main から locator の行だけが変わる", () => {
    const diff = git(
      "diff",
      "--unified=0",
      MAIN_BEFORE_POC,
      "--",
      "e2e/mfa-flow.e2e.ts",
      "e2e/unauthorized.e2e.ts",
    );
    expect(diff.status).toBe(0);
    const changed = diff.stdout
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !/^(?:\+\+\+|---) /.test(line));
    expect(changed.filter((line) => !/getBy\w+\(|\.locator\(/.test(line))).toEqual([]);
  });
});

describe("DevTools MCP を持ち込まない", () => {
  test("AC-012: .mcp.json に Foldkit の MCP が無く、FOLDKIT.md・devtools-mcp の依存が無く、vite の foldkit plugin は MCP の relay を止めている", () => {
    const listed = git("ls-files", "--cached", "--others", "--exclude-standard");
    expect(listed.status).toBe(0);
    const files = listed.stdout.split("\n").filter(Boolean);
    expect(files.filter((file) => /(?:^|\/)FOLDKIT\.md$/.test(file))).toEqual([]);
    for (const mcpConfig of files.filter((file) => /(?:^|\/)\.mcp\.json$/.test(file))) {
      expect(readFileSync(join(REPO_ROOT, mcpConfig), "utf8"), mcpConfig).not.toMatch(/foldkit/i);
    }
    expect(rootDependencies()["@foldkit/devtools-mcp"]).toBeUndefined();
    for (const config of ["web/vite.config.ts", "web/non-production/vite.config.ts"]) {
      const source = readFileSync(join(REPO_ROOT, config), "utf8");
      if (/\bfoldkit\(/.test(source)) {
        expect(source, config).toMatch(/devToolsMcpPort:\s*false/);
      }
    }
  });
});

describe("branch と commit", () => {
  test("AC-013: main から HEAD までの commit は封の commit だけで、upstream が無い", () => {
    const log = git("log", "--format=%B%x1e", `${MAIN_BEFORE_POC}..HEAD`);
    expect(log.status).toBe(0);
    const messages = log.stdout
      .split("\x1e")
      .map((message) => message.trim())
      .filter(Boolean);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.filter((message) => !/^Define-Done-Seal: /m.test(message))).toEqual([]);
    expect(git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}").status).not.toBe(0);
  });

  test("AC-014: branch の名前が 386 を含み、main の 8fa500c から切られている", () => {
    const branch = git("branch", "--show-current");
    expect(branch.stdout.trim()).toContain("386");
    expect(git("merge-base", "--is-ancestor", MAIN_BEFORE_POC, "HEAD").status).toBe(0);
  });

  test("AC-015: 設計の dir の名前が 386 を含み、中に設計の文書がある", () => {
    const designs = readdirSync(DESIGN_ROOT).filter((name) => name.includes("386"));
    expect(
      designs.some((name) =>
        readdirSync(join(DESIGN_ROOT, name)).some((file) => file.endsWith(".md")),
      ),
    ).toBe(true);
  });
});
