import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, workflowFileNames } from "./config-invariant-helpers";

const REPOSITORY = "owner/repo";
const ISSUES_PATH = `/repos/${REPOSITORY}/issues`;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

type Issue = { number: number; body: string; pull_request?: unknown };
type Write = { method: string; path: string; body: { body?: string } };

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

const fakeGitHub = (issues: Issue[], options: { failComments?: boolean } = {}) => {
  const writes: Write[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === ISSUES_PATH) {
        return Response.json(issues);
      }
      if (options.failComments === true && pathname.endsWith("/comments")) {
        return new Response("unavailable", { status: 503 });
      }
      writes.push({ method: request.method, path: pathname, body: await request.json() });
      return Response.json({}, { status: 201 });
    },
  });
  stops.push(() => void server.stop(true));
  return { url: `http://localhost:${server.port}`, issues, writes };
};

const audit = (...entries: [string, string, string][]) =>
  JSON.stringify(
    Object.fromEntries(
      entries.map(([name, ghsa, severity]) => [
        name,
        [
          {
            url: `https://github.com/advisories/${ghsa}`,
            title: ghsa,
            severity,
            vulnerable_versions: "<1",
          },
        ],
      ]),
    ),
  );

const report = async (url: string, stdin: string) => {
  const child = Bun.spawn(["bun", "scripts/report-advisories.ts"], {
    cwd: REPO_ROOT,
    env: { ...shellEnv, GITHUB_API_URL: url, GITHUB_REPOSITORY: REPOSITORY, GITHUB_TOKEN: "t" },
    stdin: new Blob([stdin]),
    stdout: "pipe",
  });
  return { exitCode: await child.exited, stdout: await new Response(child.stdout).text() };
};

const commentsIn = (writes: Write[]) => writes.filter(({ path }) => path.endsWith("/comments"));

const reportedOnce = async (stdin: string) => {
  const github = fakeGitHub([]);
  await report(github.url, stdin);
  github.issues.push({ number: 1, body: String(github.writes[0]?.body.body) });
  github.writes.length = 0;
  return github;
};

describe("scripts/report-advisories.ts (ADR-0009 §H の毎日の report)", () => {
  test("前の日と同じ advisory の集合なら何も書かない。同じ通知を毎日くり返さず、issue の編集の履歴も増やさない", async () => {
    const github = await reportedOnce(audit(["a", "GHSA-1111-1111-1111", "low"]));

    const { exitCode } = await report(github.url, audit(["a", "GHSA-1111-1111-1111", "low"]));

    expect(exitCode).toBe(0);
    expect(github.writes).toEqual([]);
  });

  test("知っている advisory が別の package に出たら知らせる。同じ advisory でも、影響を受ける依存が増えている", async () => {
    const github = await reportedOnce(audit(["a", "GHSA-1111-1111-1111", "low"]));

    await report(
      github.url,
      audit(["a", "GHSA-1111-1111-1111", "low"], ["b", "GHSA-1111-1111-1111", "low"]),
    );

    expect(commentsIn(github.writes).map(({ body }) => body.body)).toEqual([
      expect.stringContaining(" b (low)"),
    ]);
  });

  test("package 名や title の @ を mention にしない。@scope の package が実在の account に通知を送る", async () => {
    const github = fakeGitHub([]);

    await report(github.url, audit(["@opentelemetry/core", "GHSA-1111-1111-1111", "low"]));

    const shown = String(github.writes[0]?.body.body).replace(/<!--[\s\S]*?-->/g, "");
    expect(shown).toContain("opentelemetry/core");
    expect(shown).not.toContain("@opentelemetry");
  });

  test("advisory が減っただけの日は comment しない。直したことは知らせる必要が無い", async () => {
    const github = await reportedOnce(
      audit(["a", "GHSA-1111-1111-1111", "low"], ["b", "GHSA-2222-2222-2222", "moderate"]),
    );

    const { exitCode } = await report(github.url, audit(["a", "GHSA-1111-1111-1111", "low"]));

    expect(exitCode).toBe(0);
    expect(github.writes.map(({ method }) => method)).toEqual(["PATCH"]);
  });

  test("CI の audit が --ignore で通す advisory に印を付ける。CI の gate で止まらない理由が一覧から分かる", async () => {
    const github = fakeGitHub([]);
    await report(github.url, audit(["braces", "GHSA-vfj7-8cjw-p6xm", "high"]));

    expect(String(github.writes[0]?.body.body)).toContain("high (CI で ignore)");
  });

  test("新しい advisory の comment に失敗したら本文を更新しない。更新すると翌日は既知の id になり、知らせが二度と出ない", async () => {
    const github = fakeGitHub([{ number: 1, body: "<!-- advisories:  -->" }], {
      failComments: true,
    });

    const { exitCode } = await report(github.url, audit(["a", "GHSA-1111-1111-1111", "low"]));

    expect(exitCode).toBe(1);
    expect(github.writes.filter(({ method }) => method === "PATCH")).toEqual([]);
  });

  test("label の付いた open の issue が 2 件あると、どれを更新するか決められないので何も書かずに落ちる", async () => {
    const github = fakeGitHub([
      { number: 1, body: "" },
      { number: 2, body: "" },
    ]);

    const { exitCode, stdout } = await report(
      github.url,
      audit(["a", "GHSA-1111-1111-1111", "low"]),
    );

    expect(exitCode).toBe(1);
    expect(stdout).toContain("::error::");
    expect(github.writes).toEqual([]);
  });

  test("issues の一覧に混ざる pull request は、label が付いていても更新の対象にしない", async () => {
    const github = fakeGitHub([{ number: 9, body: "", pull_request: {} }]);

    await report(github.url, audit(["a", "GHSA-1111-1111-1111", "low"]));

    expect(github.writes.map(({ method, path }) => `${method} ${path}`)).toEqual([
      `POST ${ISSUES_PATH}`,
    ]);
  });
});

const workflowsWithAuditIgnore = (names: readonly string[], read: (name: string) => string) =>
  names.filter((name) => /bun audit\b/.test(read(name)) && /--ignore\b/.test(read(name)));

describe("bun audit の --ignore の置き場所 (ADR-0009 §B)", () => {
  const readWorkflowText = (name: string) =>
    readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8");

  test("workflow は bun audit の --ignore を直に書かない。package.json の audit だけが持ち、CI の gate と毎日の report が同じ一覧を読む", () => {
    expect(workflowsWithAuditIgnore(workflowFileNames(), readWorkflowText)).toEqual([]);
  });

  test("workflow に --ignore 付きの bun audit を直に書くと、報告される", () => {
    const texts: Record<string, string> = {
      "ci.yml": "run: bun audit --audit-level=high --ignore=GHSA-vfj7-8cjw-p6xm",
    };
    expect(workflowsWithAuditIgnore(["ci.yml"], (name) => texts[name] ?? "")).toEqual(["ci.yml"]);
  });
});
