export type WranglerVarKey =
  | "APP_ENV"
  | "APP_NAME"
  | "AUTH_SERVICE_URL"
  | "AUTH_COOKIE_DOMAIN"
  | "AUTH_TRUSTED_ORIGINS"
  | "AUTH_FROM_EMAIL_MAGIC_LINK"
  | "AUTH_FROM_EMAIL_WELCOME"
  | "AUTH_FROM_EMAIL_INVITATION"
  | "AUTH_FROM_EMAIL_SECURITY";

export type StageConfig = {
  readonly workerName: string;
  readonly hyperdriveName: string;
  readonly vars: Readonly<Record<WranglerVarKey, string>>;
};

const TRANSACTIONAL_SENDER = "noreply@transactional.taimei-code.com";

export const STAGES = {
  staging: {
    workerName: "taimei-auth-staging",
    hyperdriveName: "taimei-auth-staging",
    vars: {
      APP_ENV: "staging",
      APP_NAME: "taimei",
      AUTH_SERVICE_URL: "https://taimei-auth-staging.taimei-staging.workers.dev",
      AUTH_COOKIE_DOMAIN: "taimei-staging.workers.dev",
      AUTH_TRUSTED_ORIGINS:
        "https://taimei-staging.taimei-staging.workers.dev,https://taimei-auth-staging.taimei-staging.workers.dev",
      AUTH_FROM_EMAIL_MAGIC_LINK: TRANSACTIONAL_SENDER,
      AUTH_FROM_EMAIL_WELCOME: TRANSACTIONAL_SENDER,
      AUTH_FROM_EMAIL_INVITATION: TRANSACTIONAL_SENDER,
      AUTH_FROM_EMAIL_SECURITY: TRANSACTIONAL_SENDER,
    },
  },
} as const satisfies Record<string, StageConfig>;

export type StageName = keyof typeof STAGES;

export const DURABLE_OBJECT_BINDINGS = { KV_STORE: "KvStore" } as const;

export const WORKER_RUNTIME = {
  compatibility: { date: "2025-04-01", flags: ["nodejs_compat", "delete_all_deletes_alarm"] },
  assets: { runWorkerFirst: true, notFoundHandling: "single-page-application" },
} as const;

const isStageName = (name: string): name is StageName => Object.hasOwn(STAGES, name);

export const parseStage = (name: string): StageName => {
  if (isStageName(name)) return name;
  throw new Error(
    `stage "${name}" は infra/stages.ts の表に無い (${Object.keys(STAGES).join(" / ")})`,
  );
};

const DEPLOY_MODES = ["gate", "full"] as const;

export type DeployMode = (typeof DEPLOY_MODES)[number];

const isDeployMode = (value: string | undefined): value is DeployMode =>
  DEPLOY_MODES.some((mode) => mode === value);

export const parseDeployMode = (value: string | undefined): DeployMode => {
  if (isDeployMode(value)) return value;
  throw new Error(`DEPLOY_MODE "${value ?? ""}" は ${DEPLOY_MODES.join(" か ")} にする`);
};
