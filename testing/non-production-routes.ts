import type { Hono } from "hono";
import { devHomeRoutes } from "./dev-home";
import { e2eLoginLinkRoutes, e2eLoginLinksEnabled } from "./e2e-login-links";
import { testingApiRoutes } from "./routes";
import type { NonProductionEmail } from "./sent-links";

export const nonProductionRoutes = ({
  e2eLoginLinks,
  recordsEmailTo,
}: { e2eLoginLinks: boolean } & Pick<NonProductionEmail, "recordsEmailTo">): Hono[] => [
  testingApiRoutes(),
  devHomeRoutes({ recordsEmailTo }),
  ...(e2eLoginLinks ? [e2eLoginLinkRoutes()] : []),
];

export const mountNonProductionRoutes =
  ({ recordsEmailTo }: Pick<NonProductionEmail, "recordsEmailTo">) =>
  (app: Hono): void => {
    for (const routes of nonProductionRoutes({
      e2eLoginLinks: e2eLoginLinksEnabled(),
      recordsEmailTo,
    })) {
      app.route("/", routes);
    }
  };
