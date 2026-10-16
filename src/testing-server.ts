import { startBunServer } from "./bun-server";
import { testingRoutes } from "./handlers/testing-routes";
import { makeMagicLinkOutbox, recordingEmailSender } from "./testing/magic-link-outbox";

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
