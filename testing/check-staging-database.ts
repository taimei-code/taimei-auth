import { requireMarkedDatabase } from "../db/testing/non-production-database";

await requireMarkedDatabase();
console.log("[check-staging-database] the DB has the non-production mark.");
process.exit(0);
