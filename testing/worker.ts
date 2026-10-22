import * as Sentry from "@sentry/cloudflare";
import { seedDevAccounts } from "../db/testing/dev-accounts";
import { sentryOptions, type WorkerEnv, workerHandler } from "../src/worker";
import { accountPickerRoutes } from "./account-picker";
import { devHomeRoutes } from "./dev-home";
import { testingApiRoutes } from "./routes";
import { recordingEmailSender } from "./sent-links";

export { KvStore } from "../src/worker";

type SeedPlace = "S1" | "S1p" | "S2" | "none";

let seeded: Promise<void> | null = null;
const seedOnce = (): Promise<void> => {
  seeded ??= seedDevAccounts().catch((cause) => {
    seeded = null;
    throw cause;
  });
  return seeded;
};

const seedPlaceOf = (env: WorkerEnv): SeedPlace => (env.APP_POC_SEED as SeedPlace) ?? "S1";

const handler = workerHandler({
  emailSender: recordingEmailSender,
  extendBeforeStatic: (app) => {
    app.route("/", testingApiRoutes());
    app.route("/", devHomeRoutes({ seedOnEveryGet: process.env.APP_POC_SEED === "S2" }));
    if (process.env.APP_POC_PICKER_AT_AUTH === "1") app.route("/", accountPickerRoutes());
  },
  beforeRequest: async (env) => {
    if (seedPlaceOf(env) === "S1") await seedOnce();
  },
});

export default Sentry.withSentry(sentryOptions, {
  async fetch(req: Request, env: WorkerEnv, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    if (env.APP_ENV === "production") {
      return new Response("testing/worker.ts does not start with APP_ENV=production", {
        status: 500,
      });
    }
    if (seedPlaceOf(env) === "S1p") await seedOnce();
    return handler.fetch(req, env, ctx);
  },
});
