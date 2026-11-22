import { ok as ensure } from "node:assert";
import { env, exit, stdin } from "node:process";
import { text } from "node:stream/consumers";

const LABEL = "passkey-providers";
const TITLE = "パスキーの提供元の表の点検 (出どころと、表に無い aaguid)";
const KEY_LIST = /<!-- passkey-providers: (.*?) -->/;
const COMMUNITY_LIST_URL =
  "https://raw.githubusercontent.com/passkeydeveloper/passkey-authenticator-aaguids/main/aaguid.json";
const COMMUNITY_LIST_PAGE = "https://github.com/passkeydeveloper/passkey-authenticator-aaguids";
const TABLE_PATH = "src/passkey/passkey-providers.ts";
const TIMEOUT_MS = 30_000;
const NAME_MAX_LENGTH = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_AAGUID = "00000000-0000-0000-0000-000000000000";
const GONE_STATUSES = [404, 410];

export type Provider = Readonly<{ aaguid: string; name: string; source: string }>;

export type SourcePage = Readonly<{ status: number; text: string }>;

export type Finding = Readonly<{ key: string; kind: "source" | "candidate"; line: string }>;

type Issue = Readonly<{ number: number; body: string | null; pull_request?: unknown }>;

const annotate = (message: string) =>
  `::error::${message.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}`;

const requiredEnv = (name: string) => {
  const value = env[name];
  ensure(value !== undefined && value !== "", `環境変数 ${name} が無い`);
  return value;
};

export const asInlineCode = (value: string) =>
  `\`${value.replaceAll("`", "'").replaceAll(/\s+/g, " ").trim().slice(0, NAME_MAX_LENGTH)}\``;

const fieldOf = (value: unknown, field: string): unknown =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[field]
    : undefined;

export const parseTable = (output: string): ReadonlyArray<Provider> => {
  const parsed: unknown = JSON.parse(output);
  ensure(Array.isArray(parsed) && parsed.length > 0, "提供元の表が空でない配列でない");
  return parsed.map((row: unknown) => {
    const [aaguid, name, source] = ["aaguid", "name", "source"].map((field) => fieldOf(row, field));
    ensure(typeof aaguid === "string" && UUID.test(aaguid), "提供元の表の aaguid が UUID でない");
    ensure(typeof name === "string", `提供元の表の ${aaguid} に name が無い`);
    ensure(
      typeof source === "string" && source.startsWith("https://"),
      `提供元の表の ${aaguid} の source が https でない`,
    );
    return { aaguid, name, source };
  });
};

export const parseCommunityList = (json: unknown): ReadonlyMap<string, string> => {
  ensure(
    typeof json === "object" && json !== null && !Array.isArray(json),
    "community の一覧が object でない",
  );
  return new Map(
    Object.entries(json).map(([key, entry]: [string, unknown]) => {
      const aaguid = key.toLowerCase();
      ensure(UUID.test(aaguid), `community の一覧の鍵が UUID でない: ${asInlineCode(key)}`);
      const name = fieldOf(entry, "name");
      ensure(typeof name === "string", `community の一覧の ${aaguid} に name が無い`);
      return [aaguid, name];
    }),
  );
};

export const sourcePageShowsAaguid = (aaguid: string, page: SourcePage): boolean => {
  if (GONE_STATUSES.includes(page.status)) return false;
  ensure(page.status === 200, `出どころが ${page.status} を返した`);
  return page.text.toLowerCase().includes(aaguid);
};

export const sourceFindings = (
  providers: ReadonlyArray<Provider>,
  pages: ReadonlyMap<string, SourcePage>,
): ReadonlyArray<Finding> =>
  providers
    .filter(({ aaguid, source }) => {
      const page = pages.get(source);
      ensure(page !== undefined, `出どころ ${source} を取得していない`);
      return !sourcePageShowsAaguid(aaguid, page);
    })
    .map(({ aaguid, name, source }) => ({
      key: `source:${aaguid}`,
      kind: "source",
      line: `- \`${aaguid}\` ${asInlineCode(name)}: [出どころ](${source}) に aaguid が見つからない`,
    }));

export const candidateFindings = (
  providers: ReadonlyArray<Provider>,
  community: ReadonlyMap<string, string>,
): ReadonlyArray<Finding> => {
  const listed = new Set(providers.map(({ aaguid }) => aaguid));
  return [...community]
    .filter(([aaguid]) => aaguid !== ZERO_AAGUID && !listed.has(aaguid))
    .sort(([a, aName], [b, bName]) => aName.localeCompare(bName) || a.localeCompare(b))
    .map(([aaguid, name]) => ({
      key: `candidate:${aaguid}`,
      kind: "candidate",
      line: `- \`${aaguid}\` ${asInlineCode(name)}`,
    }));
};

const section = (
  heading: string,
  intro: ReadonlyArray<string>,
  lines: ReadonlyArray<string>,
  empty: string,
) => [`## ${heading}`, "", ...intro, ...(lines.length === 0 ? [empty] : lines), ""];

export const renderBody = (findings: ReadonlyArray<Finding>) => {
  const linesOf = (kind: Finding["kind"]) =>
    findings.filter((finding) => finding.kind === kind).map(({ line }) => line);
  return [
    `<!-- passkey-providers: ${findings.map(({ key }) => key).join(", ")} -->`,
    `毎週、\`${TABLE_PATH}\` の表を確かめた結果。表に行を足す時は、提供元が自分で公開した文書で値を確かめ、出どころを書いて PR で足す。community の一覧からは写さない (license の表記が無い)。`,
    "",
    ...section(
      "出どころに aaguid が見つからない行",
      [],
      linesOf("source"),
      "すべての行の出どころに aaguid が載っている。",
    ),
    ...section(
      "表に無い aaguid",
      [
        `[community の一覧](${COMMUNITY_LIST_PAGE}) にあり、表に無い aaguid。名前は一覧の表記のまま。表に足すかは、主な提供元かどうかと、提供元が値を公開しているかで決める。`,
        "",
      ],
      linesOf("candidate"),
      "community の一覧の aaguid はすべて表にある。",
    ),
  ]
    .join("\n")
    .trimEnd();
};

export const addedComment = (added: ReadonlyArray<Finding>) =>
  ["前回に無かった項目:", "", ...added.map(({ line }) => line)].join("\n");

const keysIn = (body: string | null): ReadonlySet<string> =>
  new Set(
    (body?.match(KEY_LIST)?.[1] ?? "")
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key !== ""),
  );

const fetchPage = async (url: string): Promise<SourcePage> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: response.status, text: await response.text() };
};

const fetchCommunityList = async () => {
  const response = await fetch(COMMUNITY_LIST_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  ensure(response.ok, `community の一覧が ${response.status} を返した`);
  return parseCommunityList(await response.json());
};

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
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
  const providers = parseTable(await text(stdin));
  const sources = [...new Set(providers.map(({ source }) => source))];
  const pages = new Map(
    await Promise.all(sources.map(async (url) => [url, await fetchPage(url)] as const)),
  );
  const findings = [
    ...sourceFindings(providers, pages),
    ...candidateFindings(providers, await fetchCommunityList()),
  ];
  const body = renderBody(findings);
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
  const known = keysIn(issue.body);
  const added = findings.filter(({ key }) => !known.has(key));
  if (added.length > 0) {
    await api.comment(issue.number, addedComment(added));
  }
  if (issue.body !== body) {
    await api.update(issue.number, body);
  }
};

if (import.meta.main) {
  await report().catch((error: unknown) => {
    console.log(annotate(String(error)));
    exit(1);
  });
}
