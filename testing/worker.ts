import { prepareChoosableAccounts } from "../db/testing/dev-accounts";
import { createWorker } from "../src/worker";
import { devHomeRoutes } from "./dev-home";
import { e2eLoginLinkRoutes, e2eLoginLinksEnabled } from "./e2e-login-links";
import { testingApiRoutes } from "./routes";
import {
  usesNonProductionRedirectHosts,
  serveOnlyWithNonProductionRedirectHosts,
} from "./non-production-redirect-hosts-check";
import { recordingEmailSender } from "./sent-links";
import { serveOnlyOutsideProduction } from "./serve-only-outside-production";

export { KvStore } from "../src/worker";

export default serveOnlyOutsideProduction(
  serveOnlyWithNonProductionRedirectHosts(
    usesNonProductionRedirectHosts,
    createWorker({
      emailSender: recordingEmailSender,
      extendBeforeStatic: (app) => {
        app.route("/", testingApiRoutes());
        app.route("/", devHomeRoutes());
        if (e2eLoginLinksEnabled()) app.route("/", e2eLoginLinkRoutes());
      },
      beforeFirstRequest: prepareChoosableAccounts,
    }),
  ),
);
