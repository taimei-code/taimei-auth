import server, { app } from "./index";
import { testingRoutes } from "./testing/routes";
import { handleTestingRpc, TESTING_RPC_PATH } from "./testing/rpc";

if (process.env.APP_ENV === "production") {
  console.error("FATAL: testing-server refuses APP_ENV=production.");
  process.exit(1);
}

app.route("/", testingRoutes);
app.all(`${TESTING_RPC_PATH}/*`, async (c) => (await handleTestingRpc(c.req.raw)) ?? c.notFound());

export default server;
