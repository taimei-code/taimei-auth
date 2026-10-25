import { prepareChoosableAccounts } from "../db/testing/dev-accounts";
import { postgresTtlStore } from "../db/testing/ttl-store";
import { startBunServer } from "./bun-server";
import {
  usesNonProductionRedirectHosts,
  REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER,
} from "./non-production-redirect-hosts-check";
import { devHomeRoutes } from "./dev-home";
import { testingApiAndAccountPickerRoutes } from "./routes";
import { recordingEmailSender } from "./sent-links";

if (process.env.APP_ENV !== "test") {
  console.error("FATAL: testing/server.ts starts only with APP_ENV=test.");
  process.exit(1);
}

if (!usesNonProductionRedirectHosts()) {
  console.error(REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER);
  process.exit(1);
}

const ttlStore = await postgresTtlStore();
await prepareChoosableAccounts();

export default startBunServer({
  emailSender: recordingEmailSender,
  ttlStore,
  extendBeforeStatic: (app) => {
    app.route("/", testingApiAndAccountPickerRoutes());
    app.route("/", devHomeRoutes());
  },
}).server;
