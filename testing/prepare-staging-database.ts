import { prepareMarkedNonProductionTables } from "../db/testing/non-production-tables";

await prepareMarkedNonProductionTables();
console.log(
  "[prepare-staging-database] prepared the non-production tables and the development accounts.",
);
process.exit(0);
