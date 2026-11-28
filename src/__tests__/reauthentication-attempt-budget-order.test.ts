import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Reauthenticated } from "../account/reauthentication-contract";
import { MfaChangeBudget, MfaGroup } from "../mfa/mfa-contract";
import { PasskeyManagementBudget } from "../passkey/passkey-contract";
import { spaEndpointTable } from "../spa-contract-table";
import { effectTsgo, REPO_ROOT } from "./config-invariant-helpers";

const TYPECHECK_TIMEOUT_MS = 60_000;

const probeDirectories: string[] = [];

afterAll(() => {
  for (const directory of probeDirectories) rmSync(directory, { recursive: true, force: true });
});

const typecheckFixture = (source: string) => {
  const directory = mkdtempSync(join(tmpdir(), "reauthentication-budget-order-"));
  probeDirectories.push(directory);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(directory, "node_modules"));
  mkdirSync(join(directory, "out"));
  const fixture = join(directory, "fixture.ts");
  writeFileSync(fixture, source);
  writeFileSync(
    join(directory, "tsconfig.json"),
    JSON.stringify({
      extends: join(REPO_ROOT, "tsconfig.json"),
      compilerOptions: {
        composite: false,
        noEmit: true,
        rootDir: "/",
        tsBuildInfoFile: join(directory, "out/fixture.tsbuildinfo"),
      },
      include: [fixture],
      exclude: [],
    }),
  );
  const result = spawnSync(effectTsgo(), ["--noEmit", "-p", join(directory, "tsconfig.json")], {
    encoding: "utf8",
  });
  return { exitCode: result.status, output: `${result.stdout}${result.stderr}` };
};

const contract = (path: string) => join(REPO_ROOT, path);

const IMPORTS = `
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Authenticated } from "${contract("src/account/actor-contract")}";
import { Reauthenticated } from "${contract("src/account/reauthentication-contract")}";
import { MfaChangeBudget, MfaGroup } from "${contract("src/mfa/mfa-contract")}";
import { PasskeyGroup, PasskeyManagementBudget } from "${contract("src/passkey/passkey-contract")}";
`;

const requiresNothingOutside = (group: string) =>
  `export const ${group}RequiresNothingOutside: [HttpApiGroup.MiddlewareServices<typeof ${group}>] extends [never] ? true : false = true;\n`;

const probedGroup = (endpointMiddleware: readonly string[], groupMiddleware: readonly string[]) => `
class Probed extends HttpApiGroup.make("probed")
  .add(HttpApiEndpoint.post("act", "/act")${endpointMiddleware.map((name) => `.middleware(${name})`).join("")})
${groupMiddleware.map((name) => `  .middleware(${name})`).join("\n")} {}
${requiresNothingOutside("Probed")}`;

const BUDGETS = [
  { budgetName: "MFA の変更の試行枠", budget: "MfaChangeBudget" },
  { budgetName: "パスキーの管理の試行枠", budget: "PasskeyManagementBudget" },
];

const DECLARATIONS: ReadonlyArray<{
  readonly name: string;
  readonly declaration: string;
  readonly passes: boolean;
}> = [
  {
    name: "再認証を求める endpoint から試行枠を外すと、型検査が落ちる",
    declaration: probedGroup(["Reauthenticated"], ["Authenticated"]),
    passes: false,
  },
  ...BUDGETS.flatMap(({ budgetName, budget }) => [
    {
      name: `再認証より内側に${budgetName}を並べた endpoint は、型検査が落ちる`,
      declaration: probedGroup([budget, "Reauthenticated"], ["Authenticated"]),
      passes: false,
    },
    {
      name: `再認証より外側に${budgetName}を並べた endpoint は、型検査を通る`,
      declaration: probedGroup(["Reauthenticated", budget], ["Authenticated"]),
      passes: true,
    },
  ]),
  {
    name: "同じ試行枠を再認証の前後の両方に足した宣言は、型検査を通る (この並びの誤りは、宣言を回す test が見つける)",
    declaration: probedGroup(
      ["MfaChangeBudget", "Reauthenticated", "MfaChangeBudget"],
      ["Authenticated"],
    ),
    passes: true,
  },
  {
    name: "再認証を endpoint に、試行枠を群に付けた並びは、型検査を通る",
    declaration: probedGroup(["Reauthenticated"], ["PasskeyManagementBudget", "Authenticated"]),
    passes: true,
  },
  {
    name: "今ある MFA の群とパスキーの群は、外から満たす要求が残らず型検査を通る",
    declaration: `${requiresNothingOutside("MfaGroup")}${requiresNothingOutside("PasskeyGroup")}`,
    passes: true,
  },
];

describe("再認証を求める endpoint は、session ごとの試行枠を数えた後に評価する並びでなければ型検査で落ちる", () => {
  for (const { name, declaration, passes } of DECLARATIONS) {
    test(
      name,
      () => {
        const result = typecheckFixture(`${IMPORTS}${declaration}`);

        if (passes) {
          expect(result).toEqual({ exitCode: 0, output: "" });
        } else {
          expect(result.exitCode).not.toBe(0);
          expect(result.output).toContain("TS2322");
        }
      },
      TYPECHECK_TIMEOUT_MS,
    );
  }
});

const SESSION_BUDGET_KEYS: readonly string[] = [MfaChangeBudget.key, PasskeyManagementBudget.key];

const keysInAddedOrder = (middleware: ReadonlySet<{ key: string }>): string[] =>
  [...middleware].map(({ key }) => key);

const requiresReauthentication = (middleware: ReadonlySet<{ key: string }>): boolean =>
  keysInAddedOrder(middleware).includes(Reauthenticated.key);

const countsSessionBudgetBeforeReauthentication = (
  middleware: ReadonlySet<{ key: string }>,
): boolean => {
  const keys = keysInAddedOrder(middleware);
  return keys
    .slice(keys.indexOf(Reauthenticated.key) + 1)
    .some((key) => SESSION_BUDGET_KEYS.includes(key));
};

describe("SPA の API で再認証を求める endpoint は、再認証より後に session ごとの試行枠を足している (後から足した middleware が先に走る)", () => {
  const reauthenticated = spaEndpointTable().filter(({ middleware }) =>
    requiresReauthentication(middleware),
  );

  test("再認証を求める endpoint を契約から列挙できる", () => {
    expect(reauthenticated.length).toBeGreaterThanOrEqual(4);
  });

  test("どの endpoint も、足した順で再認証より後に session ごとの試行枠がある", () => {
    expect(
      reauthenticated
        .filter(({ middleware }) => !countsSessionBudgetBeforeReauthentication(middleware))
        .map(({ name }) => name),
    ).toEqual([]);
  });

  test("同じ試行枠を再認証の前後の両方に足した宣言は、先に足した位置に残るので並びの誤りとして見つかる (Effect は endpoint の middleware を Set で持つ)", () => {
    const declaredTwice = MfaGroup.endpoints.status
      .middleware(MfaChangeBudget)
      .middleware(Reauthenticated)
      .middleware(MfaChangeBudget);

    expect(countsSessionBudgetBeforeReauthentication(declaredTwice.middlewares)).toBe(false);
  });
});
