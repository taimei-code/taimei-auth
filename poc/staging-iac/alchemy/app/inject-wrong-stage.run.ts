import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export type WorkerEnv = Cloudflare.InferEnv<typeof AppWorker>;

export const AppWorker = Cloudflare.Worker(
  "App",
  Effect.gen(function* () {
    const auth = yield* Cloudflare.Worker.ref("Auth", { stack: "PocIacAlcAuth", stage: "wrong" });
    return {
      name: "poc-iac-alc-app",
      main: "./src/worker.ts",
      env: { AUTH: auth },
    };
  }),
);

export default Alchemy.Stack(
  "PocIacAlcApp",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* AppWorker;
    return { url: worker.url.as<string>() };
  }),
);
