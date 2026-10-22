import { seedDevAccounts } from "../db/testing/dev-accounts";
import { createWorker } from "../src/worker";
import { devHomeRoutes } from "./dev-home";
import { serveOnlyOutsideProduction } from "./serve-only-outside-production";
import { testingApiRoutes } from "./routes";
import { recordingEmailSender } from "./sent-links";

export { KvStore } from "../src/worker";

const worker = createWorker({
  emailSender: recordingEmailSender,
  routesBeforeStatic: (app) => {
    app.route("/", testingApiRoutes());
    app.route("/", devHomeRoutes());
  },
  beforeFirstRequest: seedDevAccounts,
});

export default serveOnlyOutsideProduction(worker);
