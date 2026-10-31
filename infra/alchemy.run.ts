import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";
import { SECRET_BINDING_NAMES } from "../src/secret-bindings";
import {
  DURABLE_OBJECT_BINDINGS,
  parseDeployMode,
  parseStage,
  STAGES,
  WORKER_RUNTIME,
} from "./stages";

const STAGING_BUNDLE_ENTRY = "./staging-bundle/staging-worker.js";

const durableObjects = Object.fromEntries(
  Object.entries(DURABLE_OBJECT_BINDINGS).map(([binding, className]) => [
    binding,
    Cloudflare.DurableObject(className, { className }),
  ]),
);

const Auth = Cloudflare.Worker(
  "Auth",
  Effect.gen(function* () {
    const stage = STAGES[parseStage(yield* Alchemy.Stage)];
    const deployMode = parseDeployMode(process.env.DEPLOY_MODE);
    return {
      name: stage.workerName,
      main: STAGING_BUNDLE_ENTRY,
      bundle: false,
      assets: { directory: "./web/dist", ...WORKER_RUNTIME.assets },
      compatibility: {
        date: WORKER_RUNTIME.compatibility.date,
        flags: [...WORKER_RUNTIME.compatibility.flags],
      },
      workersDev: { enabled: true, previewsEnabled: false },
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
    const worker = yield* Auth;
    const store = yield* Cloudflare.SecretsStore.Store("Secrets");
    for (const name of SECRET_BINDING_NAMES) {
      yield* worker.bind(name, {
        bindings: [
          { type: "secrets_store_secret", name, secretName: name, storeId: store.storeId },
        ],
      });
    }
    return { url: worker.url.as<string>() };
  }),
);
