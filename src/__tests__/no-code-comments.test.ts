import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./source-scan";

const DIRS = ["src", "db", "web", "e2e", "management", "testing"];
const DIRECTIVE =
  /^(\/\/\/\s*<reference|\/\/\s*@ts-expect-error|\/[/*]\s*biome-ignore|\/\*\s*@vite-ignore)/;
const REGEX_CAN_START =
  /(^|[(,=:[!&|?{};+\-*%<>~^]|\b(return|typeof|case|in|of|void|yield|await))$/;

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote && source[i] !== "\n") {
    i += source[i] === "\\" ? 2 : 1;
  }
  return i + 1;
}

function skipRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length && source[i] !== "\n") {
    const c = source[i];
    if (c === "\\") i++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return i + 1;
    i++;
  }
  return i;
}

type Scan = {
  readonly source: string;
  readonly found: string[];
  readonly templateBraces: number[];
  i: number;
  braces: number;
  inTemplate: boolean;
};

function commentEnd(source: string, start: number): number {
  const close =
    source[start + 1] === "/" ? source.indexOf("\n", start) : source.indexOf("*/", start + 2) + 2;
  return close <= 1 || close === -1 ? source.length : close;
}

function stepTemplate(s: Scan): void {
  const c = s.source[s.i];
  if (c === "\\") s.i += 2;
  else if (c === "`") {
    s.inTemplate = false;
    s.i++;
  } else if (c === "$" && s.source[s.i + 1] === "{") {
    s.templateBraces.push(s.braces);
    s.braces++;
    s.inTemplate = false;
    s.i += 2;
  } else s.i++;
}

function stepBrace(s: Scan): void {
  const c = s.source[s.i];
  if (c === "{") s.braces++;
  if (c === "}") {
    s.braces--;
    if (s.templateBraces.at(-1) === s.braces) {
      s.templateBraces.pop();
      s.inTemplate = true;
    }
  }
  s.i++;
}

function startsComment({ source, i }: Scan): boolean {
  return source[i] === "/" && "/*".includes(source[i + 1] ?? "x") && source[i - 1] !== ":";
}

function startsRegex({ source, i }: Scan): boolean {
  return source[i] === "/" && REGEX_CAN_START.test(source.slice(Math.max(0, i - 8), i).trimEnd());
}

function stepCode(s: Scan): void {
  const c = s.source[s.i];
  if (startsComment(s)) {
    const end = commentEnd(s.source, s.i);
    s.found.push(s.source.slice(s.i, end));
    s.i = end;
  } else if (c === '"' || c === "'") s.i = skipQuoted(s.source, s.i);
  else if (c === "`") {
    s.inTemplate = true;
    s.i++;
  } else if (startsRegex(s)) s.i = skipRegex(s.source, s.i);
  else stepBrace(s);
}

function findComments(source: string): string[] {
  const s: Scan = { source, found: [], templateBraces: [], i: 0, braces: 0, inTemplate: false };
  while (s.i < source.length) {
    if (s.inTemplate) stepTemplate(s);
    else stepCode(s);
  }
  return s.found.filter((comment) => !DIRECTIVE.test(comment));
}

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard", ...DIRS], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file))
    .filter((file) => existsSync(join(REPO_ROOT, file)))
    .filter(
      (file) => !file.endsWith(".d.ts") && !file.includes("/gen/") && !file.endsWith(".gen.ts"),
    );
}

describe("コードにコメントを書かない (理由は名前・型・テストへ移す)", () => {
  test("directive 以外のコメントが 0 件", () => {
    const hits = sourceFiles().flatMap((file) =>
      findComments(readFileSync(join(REPO_ROOT, file), "utf8")).map(
        (comment) => `${file}: ${comment.slice(0, 80)}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  test("文字列・正規表現・template の中の // は数えず、本物のコメントは数える", () => {
    const source = [
      'const url = "http://example.com";',
      "const re = /\\/\\//g;",
      "const t = `a // b $" + "{x /* inner */} c`;",
      "const ratio = a / b / c; // trailing",
      "// line",
      "/* block */",
      "<div>{/* jsx */}</div>",
      "<a>https://example.com</a>",
      "// @ts-expect-error 型エラーを確かめる",
      "// biome-ignore lint/x: 理由",
    ].join("\n");
    expect(findComments(source)).toEqual([
      "/* inner */",
      "// trailing",
      "// line",
      "/* block */",
      "/* jsx */",
    ]);
  });
});
