import * as Alchemy from "alchemy";
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect } from "effect";

const Auth = Cloudflare.Worker(
  "Auth",
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    return {
      name: `taimei-auth-${stage}`,
      main: "./src/worker.ts",
      assets: {
        directory: "./web/dist",
        runWorkerFirst: true,
        notFoundHandling: "single-page-application" as const,
      },
      compatibility: { date: "2025-04-01", flags: ["nodejs_compat", "delete_all_deletes_alarm"] },
      env: {
        KV_STORE: Cloudflare.DurableObject("KvStore", { className: "KvStore" }),
      },
    };
  }),
);

export default Alchemy.Stack(
  "TaimeiAuth",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* Auth;
    return { url: worker.url.as<string>() };
  }),
);
