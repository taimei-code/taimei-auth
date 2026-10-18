import { startBunServer } from "../src/bun-server";

if (process.env.APP_ENV !== "test") {
  console.error("FATAL: testing/server.ts starts only with APP_ENV=test.");
  process.exit(1);
}

export default startBunServer().server;
