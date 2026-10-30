import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Neon from "alchemy/Neon";
import * as Output from "alchemy/Output";
import { Config } from "effect";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Counter } from "./src/worker.ts";

const NEON_PROJECT_ID = process.env.NEON_PROJECT_ID ?? "";

const Database = Effect.gen(function* () {
  const branch = yield* Neon.Branch("Staging", {
    project: { projectId: NEON_PROJECT_ID },
    name: "poc-iac-alc-staging",
    parentBranch: { name: "production" },
    initSource: "schema-only",
  });
  const role = yield* Neon.Role("App", { branch, name: "poc_iac_alc_app" });
  return yield* Cloudflare.Hyperdrive.Connection("Hyperdrive", {
    name: "poc-iac-alc-hd",
    origin: {
      scheme: branch.origin.scheme,
      host: branch.origin.host,
      port: branch.origin.port,
      database: branch.origin.database,
      user: role.roleName,
      password: Output.map(role.password, (password) => {
        if (password === undefined) throw new Error("role has no password");
        return password;
      }),
    },
    caching: { disabled: true },
  });
});

export type WorkerEnv = Cloudflare.InferEnv<typeof AuthWorker>;

export const AuthWorker = Cloudflare.Worker(
  "Auth",
  Effect.gen(function* () {
    const hd = yield* Database;
    return {
      name: "poc-iac-alc-auth",
      main: "./src/worker.ts",
      assets: { directory: "./public" },
      crons: ["17 * * * *"],
      workersDev: false,
      domain: { name: "poc-iac-alc-auth.taimei-code.com", zoneName: "taimei-code.com" },
      env: {
        COUNTER: Cloudflare.DurableObject<Counter>("Counter", { className: "Counter" }),
        POC_SECRET: Config.Redacted("POC_SECRET"),
        HD: hd,
      },
    };
  }),
);

export default Alchemy.Stack(
  "PocIacAlcAuth",
  {
    providers: Layer.mergeAll(Cloudflare.providers(), Neon.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* AuthWorker;
    return { url: worker.url.as<string>() };
  }),
);
