import { Effect, Layer, Redacted } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import type { Hono } from "hono";
import { Result, Role } from "../gen/auth/v1/auth_pb";
import { dieOnBoundary } from "../handlers/request-http-api";
import { runtimeServices } from "../handlers/spa-http-api";
import { verifyServiceKey } from "../service-key";
import { verifySessionProgram } from "./auth-handler";
import { checkMembershipsProgram } from "./company-handler";
import { ConsumerApi, ServiceKeyAuth } from "./consumer-contract";

const ServiceKeyAuthLive = Layer.succeed(
  ServiceKeyAuth,
  ServiceKeyAuth.of({
    serviceKey: (httpEffect, { credential }) =>
      verifyServiceKey(Redacted.value(credential)).pipe(Effect.andThen(httpEffect)),
  }),
);

const REJECTED_REASON = {
  [Result.SESSION_NOT_FOUND]: "SESSION_NOT_FOUND",
  [Result.USER_DELETED]: "USER_DELETED",
  [Result.REVISION_OUTDATED]: "REVISION_OUTDATED",
} as const;

const ROLE = { [Role.OWNER]: "OWNER", [Role.ADMIN]: "ADMIN", [Role.MEMBER]: "MEMBER" } as const;

const ConsumerHandlers = HttpApiBuilder.group(ConsumerApi, "consumer", (handlers) =>
  handlers.handleAll({
    verifySession: Effect.fnUntraced(function* ({ payload }) {
      const response = yield* verifySessionProgram(payload);
      if (response.outcome.case !== "ok") {
        const reason = response.outcome.value?.reason ?? Result.SESSION_NOT_FOUND;
        return {
          _tag: "Rejected" as const,
          reason: REJECTED_REASON[reason as keyof typeof REJECTED_REASON],
        };
      }
      const { user, session, currentRole } = response.outcome.value;
      return {
        _tag: "Verified" as const,
        user: {
          id: user?.id ?? "",
          name: user?.name ?? "",
          email: user?.email ?? "",
          emailVerified: user?.emailVerified ?? false,
          image: user?.image,
          createdAt: user?.createdAt ?? "",
          updatedAt: user?.updatedAt ?? "",
          defaultCompanyId: user?.defaultCompanyId,
        },
        session: { id: session?.id ?? "", expiresAt: session?.expiresAt ?? "" },
        currentRole: currentRole === undefined ? undefined : ROLE[currentRole as keyof typeof ROLE],
      };
    }, dieOnBoundary),
    checkMemberships: Effect.fnUntraced(function* ({ payload }) {
      const response = yield* checkMembershipsProgram(payload);
      return { companyActive: response.companyActive, memberUserIds: response.memberUserIds };
    }, dieOnBoundary),
  }),
);

const makeConsumerHandler = () =>
  HttpRouter.toWebHandler(
    HttpApiBuilder.layer(ConsumerApi, { openapiPath: "/rpc2/openapi.json" }).pipe(
      Layer.provide(ConsumerHandlers),
      Layer.provide(ServiceKeyAuthLive),
      HttpRouter.provideRequest(runtimeServices()),
      Layer.provide(runtimeServices()),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );

export function mountConsumerApi(app: Hono): void {
  let consumerHandler: ReturnType<typeof makeConsumerHandler> | undefined;
  app.all("/rpc2/*", (c) => {
    consumerHandler ??= makeConsumerHandler();
    return consumerHandler.handler(c.req.raw);
  });
}
