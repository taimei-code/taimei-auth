import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";
import {
  DURABLE_OBJECT_BINDINGS,
  parseAccountId,
  parseDeployMode,
  parseStage,
  STAGES,
  type StageConfig,
  WORKER_RUNTIME,
} from "./stages";

const durableObjects = Object.fromEntries(
  Object.entries(DURABLE_OBJECT_BINDINGS).map(([binding, className]) => [
    binding,
    Cloudflare.DurableObject(className, { className }),
  ]),
);

const servedAtProps = ({ workerName, servedAt }: StageConfig) =>
  servedAt.kind === "customDomain"
    ? { domain: servedAt.domain, workersDev: { enabled: false, previewsEnabled: false } }
    : {
        workersDev: { enabled: true, previewsEnabled: false },
        access: {
          name: workerName,
          previews: false,
          policies: [
            {
              decision: "allow" as const,
              include: [
                { cloudflareAccountMember: parseAccountId(process.env.CLOUDFLARE_ACCOUNT_ID) },
              ],
            },
            { decision: "non_identity" as const, include: ["anyValidServiceToken" as const] },
          ],
        },
      };

const Auth = Cloudflare.Worker(
  "Auth",
  Effect.gen(function* () {
    const stage: StageConfig = STAGES[parseStage(yield* Alchemy.Stage)];
    const deployMode = parseDeployMode(process.env.DEPLOY_MODE);
    return {
      name: stage.workerName,
      main: stage.entry,
      bundle: false,
      assets: { directory: "./web/dist", ...WORKER_RUNTIME.assets },
      compatibility: {
        date: WORKER_RUNTIME.compatibility.date,
        flags: [...WORKER_RUNTIME.compatibility.flags],
      },
      observability: { ...WORKER_RUNTIME.observability },
      ...servedAtProps(stage),
      ...(deployMode === "gate" ? { version: { traffic: 0 } } : {}),
      env: {
        ...durableObjects,
        CF_VERSION_METADATA: Cloudflare.Workers.VersionMetadata(),
        HYPERDRIVE: Cloudflare.Hyperdrive.lookup("Hyperdrive", { name: stage.hyperdriveName }),
        ...stage.vars,
      },
    };
  }),
);

export default Alchemy.Stack(
  "TaimeiAuth",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state({ name: "taimei-auth" }),
  },
  Effect.gen(function* () {
    const stage: StageConfig = STAGES[parseStage(yield* Alchemy.Stage)];
    const worker = yield* Auth;
    const store = yield* Cloudflare.SecretsStore.Store("Secrets");
    for (const name of stage.secrets) {
      yield* worker.bind(name, {
        bindings: [
          { type: "secrets_store_secret", name, secretName: name, storeId: store.storeId },
        ],
      });
    }
    return { url: worker.url.as<string>() };
  }),
);
