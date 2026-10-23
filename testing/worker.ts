import { seedDevAccounts } from "../db/testing/dev-accounts";
import { createWorker } from "../src/worker";
import { testingApiRoutes } from "./routes";
import { recordingEmailSender } from "./sent-links";
import { serveOnlyOutsideProduction } from "./serve-only-outside-production";

export { KvStore } from "../src/worker";

export default serveOnlyOutsideProduction(
  createWorker({
    emailSender: recordingEmailSender,
    extendBeforeStatic: (app) => {
      app.route("/", testingApiRoutes());
    },
    beforeFirstRequest: seedDevAccounts,
  }),
);
