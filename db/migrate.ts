import { join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client";

await migrate(db, { migrationsFolder: join(import.meta.dir, "..", "drizzle") });
console.log("[migrate] migrations are up to date.");
process.exit(0);
