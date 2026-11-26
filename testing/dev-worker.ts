import { requireLocalDatabase } from "../db/testing/local-database";
import { prepareNonProductionTables } from "../db/testing/non-production-tables";
import { FEATURE_FLAGS_BINDING } from "../src/feature-flags";
import { nonProductionWorker } from "./non-production-worker";
import { recordingEmail } from "./sent-links";

export { KvStore } from "../src/worker";

const database = requireLocalDatabase(process.env.NON_PRODUCTION_DATABASE_URL);

export default nonProductionWorker({
  email: recordingEmail,
  localFlagStoreApp: FEATURE_FLAGS_BINDING,
  beforeFirstRequest: () => prepareNonProductionTables(database),
});
