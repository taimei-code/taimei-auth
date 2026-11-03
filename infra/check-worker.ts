import {
  type DeployMode,
  expectedBindings,
  parseAccountId,
  parseDeployMode,
  parseStage,
  type StageName,
  STAGES,
  WORKER_RUNTIME,
  type WorkerBinding,
} from "./stages";

export type WorkerSettings = {
  readonly bindings: readonly WorkerBinding[];
  readonly workersDev: boolean;
  readonly observability: boolean;
};

const ADDED_BY_ALCHEMY = "ALCHEMY_";

const keyOf = ({ name, type }: WorkerBinding) => `${name} (${type})`;

const comparedKeys = (bindings: readonly WorkerBinding[]) =>
  new Set(bindings.filter(({ name }) => !name.startsWith(ADDED_BY_ALCHEMY)).map(keyOf));

const keysOnlyIn = (keys: Set<string>, other: Set<string>) =>
  [...keys].filter((key) => !other.has(key));

const settingMismatch = (label: string, live: boolean, expected: boolean) =>
  live === expected ? [] : [`${label} is ${live} but declared ${expected}`];

export const workerMismatches = (live: WorkerSettings, expected: WorkerSettings): string[] => {
  const liveKeys = comparedKeys(live.bindings);
  const expectedKeys = comparedKeys(expected.bindings);
  return [
    ...keysOnlyIn(liveKeys, expectedKeys).map((key) => `${key} is live but not declared`),
    ...keysOnlyIn(expectedKeys, liveKeys).map((key) => `${key} is declared but not live`),
    ...settingMismatch("workers.dev", live.workersDev, expected.workersDev),
    ...settingMismatch("observability", live.observability, expected.observability),
  ];
};

const expectedSettings = (stage: StageName, mode: DeployMode): WorkerSettings => ({
  bindings: expectedBindings(stage, mode),
  workersDev: STAGES[stage].servedAt.kind === "workersDevBehindAccess",
  observability: WORKER_RUNTIME.observability.enabled,
});

const requireToken = (): string => {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (token) return token;
  throw new Error("CLOUDFLARE_API_TOKEN が無い");
};

const readCloudflare = async <T>(path: string): Promise<T> => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${parseAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)}${path}`,
    { headers: { Authorization: `Bearer ${requireToken()}` } },
  );
  if (!response.ok) throw new Error(`GET ${path} returned ${response.status}`);
  return ((await response.json()) as { result: T }).result;
};

type Deployment = { readonly versions: readonly { readonly version_id: string }[] };

export const servingVersionIds = (deploymentsNewestFirst: readonly Deployment[]): string[] => {
  const [latest] = deploymentsNewestFirst;
  if (!latest) throw new Error("deployment が無い");
  return latest.versions.map(({ version_id }) => version_id);
};

const readLiveSettings = async (workerName: string): Promise<Map<string, WorkerSettings>> => {
  const script = `/workers/scripts/${workerName}`;
  const settings = await readCloudflare<{ observability?: { enabled?: boolean } | null }>(
    `${script}/settings`,
  );
  const subdomain = await readCloudflare<{ enabled: boolean }>(`${script}/subdomain`);
  const { deployments } = await readCloudflare<{ deployments: Deployment[] }>(
    `${script}/deployments`,
  );
  const live = new Map<string, WorkerSettings>();
  for (const versionId of servingVersionIds(deployments)) {
    const version = await readCloudflare<{ resources: { bindings: WorkerBinding[] } }>(
      `${script}/versions/${versionId}`,
    );
    live.set(versionId, {
      bindings: version.resources.bindings.map(({ name, type }) => ({ name, type })),
      workersDev: subdomain.enabled,
      observability: settings.observability?.enabled ?? false,
    });
  }
  return live;
};

if (import.meta.main) {
  const [stageArg = "", modeArg] = process.argv.slice(2);
  const stage = parseStage(stageArg);
  const expected = expectedSettings(stage, parseDeployMode(modeArg));
  const mismatches = [...(await readLiveSettings(STAGES[stage].workerName))].flatMap(
    ([versionId, live]) =>
      workerMismatches(live, expected).map((mismatch) => `${versionId}: ${mismatch}`),
  );
  for (const mismatch of mismatches) console.error(mismatch);
  if (mismatches.length > 0) process.exit(1);
  console.log(`${STAGES[stage].workerName} matches the ${stage} stage (${modeArg})`);
}
