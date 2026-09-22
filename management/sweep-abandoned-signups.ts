import { sweepAbandonedSignups } from "../src/account/sweep-abandoned-signups";
import { initAuth } from "../src/auth";
import { getRuntime } from "../src/runtime";

initAuth(getRuntime());
const execute = process.argv.includes("--execute");
const ttlHours = Number(process.env.SWEEP_TTL_HOURS ?? "24");
const report = await getRuntime().runPromise(
  sweepAbandonedSignups({ olderThanMs: ttlHours * 60 * 60 * 1000, execute }),
);
console.log(
  JSON.stringify({ mode: execute ? "execute" : "dry-run", ttlHours, ...report }, null, 2),
);
process.exit(0);
