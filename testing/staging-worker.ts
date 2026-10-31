import { requireMarkedDatabase } from "../db/testing/non-production-database";
import { nonProductionWorker } from "./non-production-worker";
import { stagingEmail } from "./staging-email-sender";

export { KvStore } from "../src/worker";

export default nonProductionWorker({
  email: stagingEmail,
  beforeFirstRequest: async () => {
    await requireMarkedDatabase();
  },
});
