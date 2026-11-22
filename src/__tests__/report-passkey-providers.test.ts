import { describe, expect, test } from "bun:test";

import {
  addedComment,
  candidateFindings,
  parseCommunityList,
  parseTable,
  renderBody,
  sourceFindings,
} from "../../scripts/report-passkey-providers";
import { PASSKEY_PROVIDERS } from "../passkey/passkey-providers";
import { readWorkflow, REPO_ROOT } from "./config-invariant-helpers";

const GPM = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4";
const UNLISTED = "6f0c3e2a-1b4d-4c8e-9a7f-2d5b8e1c4a90";
const SOURCE = "https://example.com/aaguids";
const provider = { aaguid: GPM, name: "Google パスワードマネージャー", source: SOURCE } as const;

const page = (status: number, text = "") => new Map([[SOURCE, { status, text }]]);

describe("出どころの確認 (scripts/report-passkey-providers.ts)", () => {
  test("出どころのページが大文字で aaguid を載せていても、載っているとみなす", () => {
    expect(sourceFindings([provider], page(200, `AAGUID ${GPM.toUpperCase()}`))).toEqual([]);
  });

  test("出どころのページから aaguid が消えたら、その行を知らせる", () => {
    expect(sourceFindings([provider], page(200, "no ids")).map(({ key }) => key)).toEqual([
      `source:${GPM}`,
    ]);
  });

  test("出どころのページが 404 なら、その行を知らせる", () => {
    expect(sourceFindings([provider], page(404)).map(({ key }) => key)).toEqual([`source:${GPM}`]);
  });

  test("出どころが 503 なら知らせずに落ちる。一時の障害で鍵が消えると、戻った時に同じ知らせが出直す", () => {
    expect(() => sourceFindings([provider], page(503))).toThrow("503");
  });
});

describe("community の一覧との差 (scripts/report-passkey-providers.ts)", () => {
  test("表に無い aaguid だけを候補にし、表の行と全 0 の aaguid は候補にしない", () => {
    const community = parseCommunityList({
      [GPM.toUpperCase()]: { name: "Google Password Manager" },
      [UNLISTED]: { name: "Unlisted" },
      "00000000-0000-0000-0000-000000000000": { name: "Zero" },
    });

    expect(candidateFindings([provider], community).map(({ key }) => key)).toEqual([
      `candidate:${UNLISTED}`,
    ]);
  });

  test("一覧の鍵が UUID でなければ落ちる。issue の本文の印に鍵を入れるので、形を崩す値を通さない", () => {
    expect(() => parseCommunityList({ "x -->": { name: "n" } })).toThrow("UUID でない");
  });

  test("表の JSON の aaguid が UUID でなければ落ちる", () => {
    expect(() => parseTable(JSON.stringify([{ ...provider, aaguid: "x" }]))).toThrow("UUID でない");
  });

  test("一覧が object でなければ落ちる", () => {
    expect(() => parseCommunityList([])).toThrow("object でない");
  });

  test("一覧の名前は inline code に入れ、@ を mention にせず、改行と backtick で本文の形を崩さない", () => {
    const [finding] = candidateFindings(
      [],
      parseCommunityList({ [UNLISTED]: { name: "@team `x`\n# heading" } }),
    );

    expect(finding?.line).toBe(`- \`${UNLISTED}\` \`@team 'x' # heading\``);
  });
});

describe("issue の本文 (scripts/report-passkey-providers.ts)", () => {
  test("知らせる項目が無い時も、2 つの確認の結果を書く", () => {
    const body = renderBody([]);

    expect(body).toContain("すべての行の出どころに aaguid が載っている。");
    expect(body).toContain("community の一覧の aaguid はすべて表にある。");
  });

  test("前回に無かった項目の comment は、増えた項目の行だけを含む", () => {
    const [finding] = candidateFindings([], parseCommunityList({ [UNLISTED]: { name: "U" } }));

    expect(addedComment(finding === undefined ? [] : [finding])).toContain(UNLISTED);
  });

  test("今の表の行は、表から引いた候補に出ない", () => {
    const community = new Map(PASSKEY_PROVIDERS.map(({ aaguid, name }) => [aaguid, name]));

    expect(candidateFindings(PASSKEY_PROVIDERS, community)).toEqual([]);
  });
});

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<
    string,
    { if?: string; permissions?: Record<string, string>; steps: { run?: string }[] }
  >;
}

describe("提供元の表を点検する workflow", () => {
  const workflow = readWorkflow<Workflow>("passkey-providers.yml");
  const jobs = Object.values(workflow.jobs);

  const runs = jobs.flatMap((job) =>
    job.steps.flatMap(({ run }) => (run === undefined ? [] : [run])),
  );
  const [producer, consumer] = (runs[0] ?? "").split("|").map((part) => part.trim());

  test("schedule で起動し、main でだけ、表の JSON を script に渡す 1 つの step を走らせる", () => {
    expect(workflow.on.schedule).toBeDefined();
    expect(jobs.map((job) => job.if)).toEqual(["github.ref == 'refs/heads/main'"]);
    expect(runs).toHaveLength(1);
    expect(consumer).toBe("bun scripts/report-passkey-providers.ts");
  });

  test("step が script に渡す JSON は、今の表の全行と同じ値になる。scripts/ は表を import できない (ADR-0009 §H)", async () => {
    const child = Bun.spawn(["bash", "-c", producer ?? ""], { cwd: REPO_ROOT, stdout: "pipe" });
    const output = await new Response(child.stdout).text();

    expect(await child.exited).toBe(0);
    expect(parseTable(output)).toEqual(PASSKEY_PROVIDERS);
  });

  test("書ける権限は issues だけ。PR も表の変更も作らず、表に足すのは人の PR に任せる", () => {
    expect(jobs.map((job) => job.permissions)).toEqual([{ contents: "read", issues: "write" }]);
  });
});
