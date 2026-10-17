import { startBunServer } from "../src/bun-server";
import { testingRoutes } from "./routes";
import { makeMagicLinkOutbox, recordingEmailSender } from "./magic-link-outbox";

if (process.env.APP_ENV === "production") {
  console.error("FATAL: testing-server refuses to start with APP_ENV=production.");
  process.exit(1);
}

const outbox = makeMagicLinkOutbox();

const started = startBunServer({
  emailSender: recordingEmailSender(outbox),
  extend: (app) => {
    app.route("/", testingRoutes(outbox));
  },
});

export default started.server;
