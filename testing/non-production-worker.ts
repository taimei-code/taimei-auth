import { createWorker } from "../src/worker";
import type { FakeFlagship } from "./feature-flags";
import { mountNonProductionRoutes } from "./non-production-routes";
import {
  usesNonProductionRedirectHosts,
  serveOnlyWithNonProductionRedirectHosts,
} from "./non-production-redirect-hosts-check";
import { serveOnlyOutsideProduction } from "./serve-only-outside-production";
import type { NonProductionEmail } from "./sent-links";

export const nonProductionWorker = ({
  email,
  featureFlags,
  localExplorerFlagshipApp,
  beforeFirstRequest,
}: {
  email: NonProductionEmail;
  featureFlags?: FakeFlagship;
  localExplorerFlagshipApp?: string;
  beforeFirstRequest: () => Promise<void>;
}) =>
  serveOnlyOutsideProduction(
    serveOnlyWithNonProductionRedirectHosts(
      usesNonProductionRedirectHosts,
      createWorker({
        emailSender: email.sender,
        featureFlags: featureFlags?.layer,
        beforeFirstRequest,
        extendBeforeStatic: mountNonProductionRoutes({
          recordsEmailTo: email.recordsEmailTo,
          featureFlags,
          localExplorerFlagshipApp,
        }),
      }),
    ),
  );
