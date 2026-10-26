import { requireLocalDatabase } from "../db/testing/local-database";
import { prepareNonProductionTables } from "../db/testing/non-production-tables";
import { createWorker } from "../src/worker";
import { mountNonProductionRoutes } from "./non-production-routes";
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
      extendBeforeStatic: mountNonProductionRoutes,
      beforeFirstRequest: () =>
        prepareNonProductionTables(requireLocalDatabase(process.env.NON_PRODUCTION_DATABASE_URL)),
    }),
  ),
);
