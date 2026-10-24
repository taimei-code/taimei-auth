import { prepareChoosableAccounts } from "../db/testing/dev-accounts";
import { postgresTtlStore } from "../db/testing/ttl-store";
import { startBunServer } from "../src/bun-server";
import { devHomeRoutes } from "./dev-home";
import { testingApiAndAccountPickerRoutes } from "./routes";
import { recordingEmailSender } from "./sent-links";

if (process.env.APP_ENV !== "test") {
  console.error("FATAL: testing/server.ts starts only with APP_ENV=test.");
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
