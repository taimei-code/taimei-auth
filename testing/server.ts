import { startBunServer } from "../src/bun-server";
import { makeMagicLinkOutbox, recordingEmailSender } from "./magic-link-outbox";
import { testingRoutes } from "./routes";

if (process.env.APP_ENV !== "test") {
  console.error("FATAL: testing/server.ts starts only with APP_ENV=test.");
  process.exit(1);
}

const outbox = makeMagicLinkOutbox();

export default startBunServer({
  emailSender: recordingEmailSender(outbox),
  extend: (app) => {
    app.route("/", testingRoutes(outbox));
  },
}).server;
