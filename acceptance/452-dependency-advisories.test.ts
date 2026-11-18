import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const ADR_0009 = "docs/adr/0009-supply-chain-hardening.md";
const WORKFLOWS_DIR = ".github/workflows";
const REPOSITORY = "taimei-code/taimei-auth-fixture";
const AUDIT_PIPE = /bun audit --json\s*\|\s*(.+)$/m;

const { NODE_ENV: _testRunnerNodeEnv, ...shellEnv } = process.env;

interface WorkflowStep {
  run?: string;
}

interface WorkflowJob {
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
}

interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, WorkflowJob>;
}

interface Advisory {
  id: number;
  url: string;
  title: string;
  severity: "low" | "moderate";
  vulnerable_versions: string;
}

type AuditOutput = Record<string, Advisory[]>;

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

const workflows = () =>
  readdirSync(join(REPO_ROOT, WORKFLOWS_DIR))
    .filter((name) => /\.ya?ml$/.test(name))
    .map((name) => Bun.YAML.parse(read(join(WORKFLOWS_DIR, name))) as Workflow);

const writesIssues = (workflow: Workflow) =>
  workflow.permissions?.issues === "write" ||
  Object.values(workflow.jobs).some((job) => job.permissions?.issues === "write");

const scheduledIssueWorkflows = () =>
  workflows().filter((workflow) => workflow.on?.schedule !== undefined && writesIssues(workflow));

const reportCommand = (): string => {
  const commands = scheduledIssueWorkflows()
    .flatMap((workflow) => Object.values(workflow.jobs))
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) => {
      const matched = step.run?.match(AUDIT_PIPE);
      return matched?.[1] === undefined ? [] : [matched[1].trim()];
    });
  if (commands.length !== 1) {
    throw new Error(`bun audit --json を受ける step が 1 つでない: ${JSON.stringify(commands)}`);
  }
  return commands[0] as string;
};

const advisory = (
  ghsa: string,
  severity: Advisory["severity"],
  id: number,
): Advisory => ({
  id,
  url: `https://github.com/advisories/${ghsa}`,
  title: `fixture advisory ${ghsa}`,
  severity,
  vulnerable_versions: "<9.9.9",
});

const MODERATE = "GHSA-aaaa-bbbb-cccc";
const LOW = "GHSA-dddd-eeee-ffff";
const ADDED = "GHSA-gggg-hhhh-jjjj";

const TWO_ADVISORIES: AuditOutput = {
  "fixture-a": [advisory(MODERATE, "moderate", 1)],
  "fixture-b": [advisory(LOW, "low", 2)],
};

const THREE_ADVISORIES: AuditOutput = {
  ...TWO_ADVISORIES,
  "fixture-c": [advisory(ADDED, "moderate", 3)],
};

interface Issue {
  number: number;
  body: string;
  state: "open";
  labels: { name: string }[];
}

interface Write {
  method: string;
  path: string;
  body: { body?: string; labels?: string[] };
}

interface FakeGitHub {
  url: string;
  issues: Issue[];
  writes: Write[];
  stop: () => void;
}

const servers: FakeGitHub[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
});

const issuesPath = `/repos/${REPOSITORY}/issues`;

const createIssue = (state: FakeGitHub, body: Write["body"]) => {
  const created: Issue = {
    number: state.issues.length + 1,
    body: body.body ?? "",
    state: "open",
    labels: (body.labels ?? []).map((name) => ({ name })),
  };
  state.issues.push(created);
  return Response.json(created, { status: 201 });
};

const answerIssue = (state: FakeGitHub, method: string, pathname: string, body: Write["body"]) => {
  const matched = pathname.match(new RegExp(`^${issuesPath}/(\\d+)(/comments)?$`));
  const issue = state.issues.find((each) => each.number === Number(matched?.[1]));
  if (issue === undefined) {
    return new Response("not found", { status: 404 });
  }
  if (method === "PATCH" && matched?.[2] === undefined) {
    issue.body = body.body ?? issue.body;
    return Response.json(issue);
  }
  if (method === "POST" && matched?.[2] === "/comments") {
    return Response.json({ id: 1, body: body.body }, { status: 201 });
  }
  return new Response("not found", { status: 404 });
};

const fakeGitHub = (issues: Issue[]): FakeGitHub => {
  const state: FakeGitHub = { url: "", issues, writes: [], stop: () => {} };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === issuesPath) {
        return Response.json(state.issues);
      }
      const body = (await request.json().catch(() => ({}))) as Write["body"];
      state.writes.push({ method: request.method, path: pathname, body });
      return request.method === "POST" && pathname === issuesPath
        ? createIssue(state, body)
        : answerIssue(state, request.method, pathname, body);
    },
  });
  state.url = `http://localhost:${server.port}`;
  state.stop = () => void server.stop(true);
  servers.push(state);
  return state;
};

const runReport = async (github: FakeGitHub, stdin: string) => {
  const child = Bun.spawn(["bash", "-c", reportCommand()], {
    cwd: REPO_ROOT,
    env: {
      ...shellEnv,
      GITHUB_API_URL: github.url,
      GITHUB_REPOSITORY: REPOSITORY,
      GITHUB_TOKEN: "fixture-token",
    },
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await child.exited;
  return { exitCode, stderr: await new Response(child.stderr).text() };
};

const comments = (github: FakeGitHub) =>
  github.writes.filter(({ method, path }) => method === "POST" && path.endsWith("/comments"));

describe("high 未満の advisory が届く経路 (#452)", () => {
  test("AC-001: ADR-0009 の §H に、Dependabot alerts と #452 を同じ段落で扱う段落がある", () => {
    const sectionH = read(ADR_0009).split(/^### /m).find((section) => section.startsWith("H. "));
    const paragraphs = (sectionH ?? "").split(/\n\s*\n/);
    expect(
      paragraphs.some(
        (paragraph) => paragraph.includes("Dependabot alerts") && paragraph.includes("#452"),
      ),
    ).toBe(true);
  });

  test("AC-002: schedule で起動し、issues に書ける permission を持つ workflow がある", () => {
    expect(scheduledIssueWorkflows().length).toBeGreaterThan(0);
  });

  test("AC-003: open の issue が無い時、moderate と low の advisory だけの出力から issue を 1 つ作り、本文がすべての id を含む", async () => {
    const github = fakeGitHub([]);
    const { exitCode, stderr } = await runReport(github, JSON.stringify(TWO_ADVISORIES));

    expect({ exitCode, stderr }).toMatchObject({ exitCode: 0 });
    expect(github.issues).toHaveLength(1);
    expect(github.issues[0]?.body).toContain(MODERATE);
    expect(github.issues[0]?.body).toContain(LOW);
  });

  test("AC-004: 前回の本文の issue があり advisory が 1 件増えると、増えた id だけを含む comment を 1 つ出す", async () => {
    const github = fakeGitHub([]);
    await runReport(github, JSON.stringify(TWO_ADVISORIES));
    github.writes.length = 0;

    const { exitCode } = await runReport(github, JSON.stringify(THREE_ADVISORIES));

    expect(exitCode).toBe(0);
    const posted = comments(github);
    expect(posted).toHaveLength(1);
    const commentBody = posted[0]?.body.body ?? "";
    expect(commentBody).toContain(ADDED);
    expect(commentBody).not.toContain(MODERATE);
    expect(commentBody).not.toContain(LOW);
  });

  test("AC-005: JSON として読めない出力では 0 以外で終わり、GitHub に書き込まない", async () => {
    const github = fakeGitHub([]);
    const { exitCode } = await runReport(github, "error: could not reach the advisory database");

    expect(exitCode).not.toBe(0);
    expect(github.writes.filter(({ method }) => method === "POST" || method === "PATCH")).toEqual(
      [],
    );
  });

  test("AC-006: CI の check job の依存の audit は high 以上で落ち、--ignore は GHSA-vfj7-8cjw-p6xm と GHSA-fc5q-39xc-vjpf だけ (ADR-0009 §B)", () => {
    const ci = Bun.YAML.parse(read(join(WORKFLOWS_DIR, "ci.yml"))) as Workflow;
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> })
      .scripts;
    const resolve = (run: string) => {
      const viaScript = run.trim().match(/^bun run (\S+)$/);
      return viaScript?.[1] === undefined ? run : (scripts[viaScript[1]] ?? run);
    };
    const audits = (ci.jobs.check?.steps ?? [])
      .flatMap((step) => (step.run === undefined ? [] : [resolve(step.run)]))
      .filter((run) => /^\s*bun audit\b/.test(run));

    expect(audits).toHaveLength(1);
    expect(audits[0]).toContain("--audit-level=high");
    expect([...(audits[0] ?? "").matchAll(/--ignore=(\S+)/g)].map(([, id]) => id)).toEqual([
      "GHSA-vfj7-8cjw-p6xm",
      "GHSA-fc5q-39xc-vjpf",
    ]);
  });
});
