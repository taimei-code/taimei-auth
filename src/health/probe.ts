import { Effect } from "effect";
import type { DbError, TtlStoreError } from "../errors";
import { captureCauseAs } from "../sentry";
import { TtlStore } from "../ttl-store-service";
import { HealthRepo } from "./ports";

type CheckResult = "ok" | "error";

const settle = (check: "db" | "ttlStore", probe: Effect.Effect<void, DbError | TtlStoreError>) =>
  probe.pipe(
    Effect.as<CheckResult>("ok"),
    Effect.catch(captureCauseAs<CheckResult>("error", { tags: { handler: "health", check } })),
  );

export const probeHealth = Effect.fn("health.probeHealth")(function* () {
  const health = yield* HealthRepo;
  const store = yield* TtlStore;
  const [db, ttlStore] = yield* Effect.all(
    [settle("db", health.pingDatabase()), settle("ttlStore", store.ping())],
    { concurrency: "unbounded" },
  );
  const status = db === "ok" && ttlStore === "ok" ? "ok" : "degraded";
  return { status, checks: { db, ttlStore } };
});
