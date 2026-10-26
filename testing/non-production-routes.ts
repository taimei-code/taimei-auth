import type { Hono } from "hono";
import { devHomeRoutes } from "./dev-home";
import { e2eLoginLinkRoutes, e2eLoginLinksEnabled } from "./e2e-login-links";
import { testingApiRoutes } from "./routes";

export const nonProductionRoutes = ({ e2eLoginLinks }: { e2eLoginLinks: boolean }): Hono[] => [
  testingApiRoutes(),
  devHomeRoutes(),
  ...(e2eLoginLinks ? [e2eLoginLinkRoutes()] : []),
];

export const mountNonProductionRoutes = (app: Hono): void => {
  for (const routes of nonProductionRoutes({ e2eLoginLinks: e2eLoginLinksEnabled() })) {
    app.route("/", routes);
  }
};
