import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config } from "effect";
import * as Effect from "effect/Effect";

export const M6Worker = Cloudflare.Worker(
  "M6",
  Effect.gen(function* () {
    const stage = process.env.ALCHEMY_STAGE;
    return {
      name: `poc-iac-alc-m6-${stage}`,
      main: "./src/worker.ts",
      env: { M6_SECRET: Config.Redacted("M6_SECRET") },
    };
  }),
);

export default Alchemy.Stack(
  "PocIacAlcM6",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const worker = yield* M6Worker;
    return { url: worker.url.as<string>() };
  }),
);
