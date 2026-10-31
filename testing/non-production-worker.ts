import { createWorker } from "../src/worker";
import { mountNonProductionRoutes } from "./non-production-routes";
import {
  usesNonProductionRedirectHosts,
  serveOnlyWithNonProductionRedirectHosts,
} from "./non-production-redirect-hosts-check";
import { serveOnlyOutsideProduction } from "./serve-only-outside-production";
import type { NonProductionEmail } from "./sent-links";

export const nonProductionWorker = ({
  email,
  beforeFirstRequest,
}: {
  email: NonProductionEmail;
  beforeFirstRequest: () => Promise<void>;
}) =>
  serveOnlyOutsideProduction(
    serveOnlyWithNonProductionRedirectHosts(
      usesNonProductionRedirectHosts,
      createWorker({
        emailSender: email.sender,
        beforeFirstRequest,
        extendBeforeStatic: mountNonProductionRoutes(email),
      }),
    ),
  );
