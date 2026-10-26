import { requireLocalDatabase } from "../db/testing/local-database";
import { prepareNonProductionTables } from "../db/testing/non-production-tables";
import { postgresTtlStore } from "../db/testing/ttl-store";
import { proxyTrustFromEnv } from "../src/request-context";
import { mergeSessionIndex } from "../src/session-index";
import { startBunServer } from "./bun-server";
import {
  usesNonProductionRedirectHosts,
  REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER,
} from "./non-production-redirect-hosts-check";
import { mountNonProductionRoutes } from "./non-production-routes";
import {
  isOutsideProduction,
  OUTSIDE_PRODUCTION_ONLY_MESSAGE,
} from "./serve-only-outside-production";
import { recordingEmailSender } from "./sent-links";

if (!isOutsideProduction(process.env.APP_ENV)) {
  console.error(OUTSIDE_PRODUCTION_ONLY_MESSAGE);
  process.exit(1);
}

if (!usesNonProductionRedirectHosts()) {
  console.error(REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER);
  process.exit(1);
}

if (!process.env.AUTH_SERVICE_KEY) {
  console.error("FATAL: AUTH_SERVICE_KEY is required.");
  process.exit(1);
}

const proxyTrust = proxyTrustFromEnv();
if (proxyTrust._tag === "Unconfigured") {
  console.error("FATAL: AUTH_TRUSTED_PROXY_HOPS (non-negative integer) is required.");
  process.exit(1);
}

const database = requireLocalDatabase(process.env.DATABASE_URL);
await prepareNonProductionTables(database);
const ttlStore = await postgresTtlStore(database, mergeSessionIndex);

export default startBunServer({
  emailSender: recordingEmailSender,
  ttlStore,
  proxyTrust,
  extendBeforeStatic: mountNonProductionRoutes,
}).server;
