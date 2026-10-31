import { requireLocalDatabase } from "../db/testing/local-database";
import { prepareNonProductionTables } from "../db/testing/non-production-tables";
import { nonProductionWorker } from "./non-production-worker";
import { recordingEmail } from "./sent-links";

export { KvStore } from "../src/worker";

export default nonProductionWorker({
  email: recordingEmail,
  beforeFirstRequest: () =>
    prepareNonProductionTables(requireLocalDatabase(process.env.NON_PRODUCTION_DATABASE_URL)),
});
