import { postgresFlagRulesStore } from "../db/testing/feature-flag-rules";
import { requireLocalDatabase } from "../db/testing/local-database";
import { prepareNonProductionTables } from "../db/testing/non-production-tables";
import { fakeFlagship } from "./feature-flags";
import { nonProductionWorker } from "./non-production-worker";
import { recordingEmail } from "./sent-links";

export { KvStore } from "../src/worker";

const database = requireLocalDatabase(process.env.NON_PRODUCTION_DATABASE_URL);

export default nonProductionWorker({
  email: recordingEmail,
  featureFlags: fakeFlagship(postgresFlagRulesStore(database)),
  beforeFirstRequest: () => prepareNonProductionTables(database),
});
