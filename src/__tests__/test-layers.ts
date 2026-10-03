import { Deferred, Effect, Layer, Ref } from "effect";
import { AuditLog } from "../audit/ports";
import { AuditLogLive } from "../audit/wiring";
import { AuthApi } from "../auth-service";
import { AuthApiError, TtlStoreError } from "../errors";
import { HealthRepo } from "../health/ports";
import type { RateWindowResult } from "../ttl-store";
import { TtlStore } from "../ttl-store-service";
import { partial } from "./live-runner";
import { TestDb } from "./test-db";

export const failingTtlStoreLayer: Layer.Layer<TtlStore> = Layer.succeed(
  TtlStore,
  partial<TtlStore["Service"]>({
    incrementRateWindow: () =>
      Effect.fail(new TtlStoreError({ cause: new Error("test: ttl store down") })),
  }),
);

export const ttlStoreReturning = (result: RateWindowResult): Layer.Layer<TtlStore> =>
  Layer.succeed(
    TtlStore,
    partial<TtlStore["Service"]>({ incrementRateWindow: () => Effect.succeed(result) }),
  );

export const healthRepoLayer = (
  pingDatabase: HealthRepo["Service"]["pingDatabase"],
): Layer.Layer<HealthRepo> => Layer.succeed(HealthRepo, { pingDatabase });

export const ttlStorePingLayer = (ping: TtlStore["Service"]["ping"]): Layer.Layer<TtlStore> =>
  Layer.succeed(TtlStore, partial<TtlStore["Service"]>({ ping }));

export const authApiWith = (override: (live: AuthApi["Service"]) => Partial<AuthApi["Service"]>) =>
  Layer.effect(
    AuthApi,
    Effect.map(AuthApi, (live) => AuthApi.of({ ...live, ...override(live) })),
  );

export const auditLogWith = (
  override: (live: AuditLog["Service"]) => Partial<AuditLog["Service"]>,
) =>
  Layer.effect(
    AuditLog,
    Effect.map(AuditLog, (live) => AuditLog.of({ ...live, ...override(live) })),
  ).pipe(Layer.provide(AuditLogLive));

export const holdBeforeCommit =
  (written: Deferred.Deferred<void>, release: Deferred.Deferred<void>) =>
  <A, E>(write: Effect.Effect<A, E>) =>
    write.pipe(
      Effect.tap(() => Deferred.succeed(written, undefined)),
      Effect.tap(() => Deferred.await(release)),
    );

export const failingSessionDeletion = Effect.gen(function* () {
  const db = yield* TestDb;
  const userRowPresentAtCall = yield* Ref.make<boolean[]>([]);
  const layer = authApiWith(() => ({
    deleteUserSessions: (userId) =>
      db.readUser(userId).pipe(
        Effect.tap((row) =>
          Ref.update(userRowPresentAtCall, (seen) => [...seen, row !== undefined]),
        ),
        Effect.orDie,
        Effect.andThen(new AuthApiError({ cause: "ttl store down" })),
      ),
  }));
  return { layer, userRowPresentAtCall };
});
