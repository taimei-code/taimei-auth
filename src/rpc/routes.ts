import type { ConnectRouter } from "@connectrpc/connect";
import { registerAuthService } from "./auth-handler";
import { registerCompanyService } from "./company-handler";
import { registerGetSession } from "./get-session-handler";
import { registerUserService } from "./user-handler";

export function registerRoutes(router: ConnectRouter) {
  registerAuthService(router);
  registerUserService(router);
  registerCompanyService(router);
  registerGetSession(router);
}
