import { Effect } from "effect";
import type { DbError, TtlStoreError } from "../errors";
import { captureCause } from "../sentry";
import { TtlStore } from "../ttl-store-service";
import { HealthRepo } from "./ports";

type CheckResult = "ok" | "error";

const settle = (check: "db" | "ttlStore", probe: Effect.Effect<void, DbError | TtlStoreError>) =>
  probe.pipe(
    Effect.as<CheckResult>("ok"),
    Effect.catch((failure) =>
      captureCause({ tags: { handler: "health", check } })(failure).pipe(
        Effect.as<CheckResult>("error"),
      ),
    ),
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
