import { parseStage } from "./stages";

const EFFECT_LOG_PREFIX = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] [A-Z]+ \(#\d+\)(?: [^:]+)?: /;
const OPERATION_LINE = /^\s*(\[[^\]]+\]\s+(\S+))(?:\s.*)?$/;
const IN_SYNC_OPERATIONS = new Set(["noop", "unchanged"]);
const NO_CHANGES = /\bno changes\b/i;

const DEFINITION = "infra/alchemy.run.ts";

const DEFINITION_ARGUMENTS = {
  plan: [DEFINITION],
  drift: ["--config", DEFINITION],
} as const;

export const differingOperationLines = (output: string): string[] => {
  const operations = output.split("\n").flatMap((line) => {
    const match = OPERATION_LINE.exec(line.replace(EFFECT_LOG_PREFIX, ""));
    return match?.[1] && match[2] ? [{ line: match[1], operation: match[2] }] : [];
  });
  if (operations.length === 0 && !NO_CHANGES.test(output)) {
    throw new Error("alchemy の出力に操作の行も no changes も無い (出力の形が変わった)");
  }
  return operations
    .filter(({ operation }) => !IN_SYNC_OPERATIONS.has(operation))
    .map(({ line }) => line);
};

const runAlchemy = (command: "plan" | "drift", stage: string): string => {
  const result = Bun.spawnSync(
    ["bunx", "alchemy", command, ...DEFINITION_ARGUMENTS[command], "--stage", stage, "--no-input"],
    {
      env: { ...process.env, NO_COLOR: "1", DEPLOY_MODE: "gate", ALCHEMY_TELEMETRY_DISABLED: "1" },
    },
  );
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
  if (result.exitCode !== 0) {
    console.error(output);
    throw new Error(`alchemy ${command} exited with ${result.exitCode}`);
  }
  return output;
};

if (import.meta.main) {
  const stage = parseStage(process.argv[2] ?? "");
  const differences = [
    ...differingOperationLines(runAlchemy("plan", stage)),
    ...differingOperationLines(runAlchemy("drift", stage)),
  ];
  for (const difference of differences) console.error(`DRIFT: ${difference}`);
  if (differences.length > 0) process.exit(1);
}
