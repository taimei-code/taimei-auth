import type { Hono } from "hono";
import { devHomeRoutes } from "./dev-home";
import { e2eLoginLinkRoutes, e2eLoginLinksEnabled } from "./e2e-login-links";
import type { FakeFlagship } from "./feature-flags";
import { featureFlagRoutes, testingApiRoutes } from "./routes";
import type { NonProductionEmail } from "./sent-links";

export const nonProductionRoutes = ({
  e2eLoginLinks,
  recordsEmailTo,
  featureFlags,
  localExplorerFlagshipApp,
}: {
  e2eLoginLinks: boolean;
  featureFlags?: FakeFlagship;
  localExplorerFlagshipApp?: string;
} & Pick<NonProductionEmail, "recordsEmailTo">): Hono[] => [
  testingApiRoutes(),
  devHomeRoutes({ recordsEmailTo, featureFlags, localExplorerFlagshipApp }),
  ...(e2eLoginLinks ? [e2eLoginLinkRoutes()] : []),
  ...(featureFlags ? [featureFlagRoutes(featureFlags)] : []),
];

export const mountNonProductionRoutes =
  ({
    recordsEmailTo,
    featureFlags,
    localExplorerFlagshipApp,
  }: Pick<NonProductionEmail, "recordsEmailTo"> & {
    featureFlags?: FakeFlagship;
    localExplorerFlagshipApp?: string;
  }) =>
  (app: Hono): void => {
    for (const routes of nonProductionRoutes({
      e2eLoginLinks: e2eLoginLinksEnabled(),
      recordsEmailTo,
      featureFlags,
      localExplorerFlagshipApp,
    })) {
      app.route("/", routes);
    }
  };
