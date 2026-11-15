import { ok as ensure } from "node:assert";
import { join } from "node:path";
import { env, exit, stdin } from "node:process";
import { text } from "node:stream/consumers";

const LABEL = "dependency-advisories";
const TITLE = "依存の advisory の一覧 (high 未満と CI で ignore した advisory を含む)";
const ID_LIST = /<!-- advisories: (.*?) -->/;
const GITHUB_TIMEOUT_MS = 30_000;
const SEVERITY_ORDER = ["critical", "high", "moderate", "low"];
const severityRank = (severity: string) =>
  SEVERITY_ORDER.includes(severity) ? SEVERITY_ORDER.indexOf(severity) : SEVERITY_ORDER.length;

type Advisory = Readonly<{
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
}>;

type Row = Advisory & Readonly<{ id: string; packageName: string; key: string }>;

type Issue = Readonly<{ number: number; body: string | null; pull_request?: unknown }>;

const annotate = (message: string) =>
  `::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

const requiredEnv = (name: string) => {
  const value = env[name];
  ensure(value !== undefined && value !== "", `環境変数 ${name} が無い`);
  return value;
};

const isAdvisory = (value: unknown): value is Advisory =>
  typeof value === "object" &&
  value !== null &&
  ["url", "title", "severity", "vulnerable_versions"].every(
    (field) => typeof (value as Record<string, unknown>)[field] === "string",
  );

const advisoryId = ({ url }: Advisory) => url.split("/").at(-1) ?? url;

const parseAudit = (output: string): ReadonlyArray<Row> => {
  const parsed: unknown = JSON.parse(output);
  ensure(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed),
    "bun audit --json の出力が object でない",
  );
  return Object.entries(parsed)
    .flatMap(([packageName, advisories]: [string, unknown]) => {
      ensure(Array.isArray(advisories), `bun audit --json の ${packageName} が配列でない`);
      return advisories.map((advisory: unknown) => {
        ensure(isAdvisory(advisory), `bun audit --json の ${packageName} の advisory の形が違う`);
        const id = advisoryId(advisory);
        return { ...advisory, packageName, id, key: `${packageName}:${id}` };
      });
    })
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        a.packageName.localeCompare(b.packageName),
    );
};

const ignoredInCi = async (): Promise<ReadonlySet<string>> => {
  const { scripts } = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as {
    scripts: Record<string, string>;
  };
  return new Set([...(scripts.audit ?? "").matchAll(/--ignore=(\S+)/g)].map(([, id]) => id ?? ""));
};

const withoutMention = (value: string) => value.replaceAll("@", "@\u200b");

const escapeCell = (value: string) =>
  withoutMention(value).replaceAll("|", "\\|").replaceAll("\n", " ");

const rowLine = (row: Row, ignored: ReadonlySet<string>) =>
  `| ${escapeCell(row.packageName)} | ${row.severity}${ignored.has(row.id) ? " (CI で ignore)" : ""} | [${row.id}](${row.url}) ${escapeCell(row.title)} | ${escapeCell(row.vulnerable_versions)} |`;

const renderBody = (rows: ReadonlyArray<Row>, ignored: ReadonlySet<string>) =>
  [
    `<!-- advisories: ${rows.map(({ key }) => key).join(", ")} -->`,
    "毎日の `bun audit --json` が見つけた advisory の一覧。前の日に無かった advisory が出た日は comment で知らせる (ADR-0009 §H)。",
    "",
    ...(rows.length === 0
      ? ["advisory は無い。"]
      : [
          "| package | severity | advisory | 対象の版 |",
          "|---|---|---|---|",
          ...rows.map((row) => rowLine(row, ignored)),
        ]),
  ].join("\n");

const idsIn = (body: string | null): ReadonlySet<string> =>
  new Set(
    (body?.match(ID_LIST)?.[1] ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );

const github = (apiUrl: string, repository: string, token: string) => {
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await fetch(`${apiUrl}/repos/${repository}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    ensure(response.ok, `${method} ${path} が ${response.status} で失敗した`);
    return response.json();
  };
  return {
    openIssues: async () =>
      ((await call("GET", `/issues?labels=${LABEL}&state=open&per_page=100`)) as Issue[]).filter(
        (issue) => issue.pull_request === undefined,
      ),
    create: (body: string) => call("POST", "/issues", { title: TITLE, body, labels: [LABEL] }),
    update: (number: number, body: string) => call("PATCH", `/issues/${number}`, { body }),
    comment: (number: number, body: string) => call("POST", `/issues/${number}/comments`, { body }),
  };
};

const report = async () => {
  const rows = parseAudit(await text(stdin));
  const body = renderBody(rows, await ignoredInCi());
  const api = github(
    requiredEnv("GITHUB_API_URL"),
    requiredEnv("GITHUB_REPOSITORY"),
    requiredEnv("GITHUB_TOKEN"),
  );
  const issues = await api.openIssues();
  ensure(issues.length <= 1, `label ${LABEL} の open の issue が ${issues.length} 件ある`);
  const [issue] = issues;
  if (issue === undefined) {
    await api.create(body);
    return;
  }
  const known = idsIn(issue.body);
  const added = rows.filter(({ key }) => !known.has(key));
  if (added.length > 0) {
    await api.comment(
      issue.number,
      [
        "前の日に無かった advisory:",
        "",
        ...added.map(
          (row) =>
            `- [${row.id}](${row.url}) ${withoutMention(row.packageName)} (${row.severity}) ${withoutMention(row.title)}`,
        ),
      ].join("\n"),
    );
  }
  if (issue.body !== body) {
    await api.update(issue.number, body);
  }
};

await report().catch((error: unknown) => {
  console.log(annotate(String(error)));
  exit(1);
});
