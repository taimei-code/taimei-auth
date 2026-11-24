import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import type { Counter } from "./src/worker.ts";

export const LegacyWorker = Cloudflare.Worker("Legacy", {
  name: "poc-iac-alc-legacy",
  main: "./src/worker.ts",
  env: {
    COUNTER: Cloudflare.DurableObject<Counter>("Counter", { className: "Counter" }),
  },
}).pipe(Alchemy.AdoptPolicy.adopt(true));

export default Alchemy.Stack(
  "PocIacAlcLegacy",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* LegacyWorker;
    return { url: worker.url.as<string>() };
  }),
);
