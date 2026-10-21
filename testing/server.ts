import { postgresTtlStore } from "../db/testing/ttl-store";
import { startBunServer } from "../src/bun-server";
import { testingRoutes } from "./routes";
import { recordingEmailSender } from "./sent-links";

if (process.env.APP_ENV !== "test") {
  console.error("FATAL: testing/server.ts starts only with APP_ENV=test.");
  process.exit(1);
}

const ttlStore = await postgresTtlStore();

export default startBunServer({
  emailSender: recordingEmailSender,
  ttlStore,
  extend: (app) => {
    app.route("/", testingRoutes());
  },
}).server;
