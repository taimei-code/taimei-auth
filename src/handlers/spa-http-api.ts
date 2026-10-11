import { Cause, Context, Effect, ErrorReporter, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiError } from "effect/http-api";
import type { Hono } from "hono";
import { Authenticated, CurrentActor } from "../account/actor-contract";
import { UserRepo } from "../account/ports";
import { AuthApi } from "../auth-service";
import { requireActor } from "../membership/guard";
import { type AppServices, getRuntime } from "../runtime";
import { SentryService } from "../sentry";
import { SpaApi } from "../spa-contract";
import { AccountHandlers } from "./account-http-api";
import { parseClientFacingError, settleCause } from "./client-facing-error";
import { CompanyHandlers } from "./company-http-api";
import { InvitationHandlers } from "./invitation-http-api";
import { MembershipHandlers } from "./membership-http-api";
import { MfaChallengeHandlers, MfaHandlers } from "./mfa-http-api";
import { headersOf } from "./request-http-api";

const AuthenticatedLive = Layer.effect(
  Authenticated,
  Effect.gen(function* () {
    const services = yield* Effect.context<AuthApi | UserRepo | SentryService>();
    return Authenticated.of(
      Effect.fnUntraced(function* (httpEffect) {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const actor = yield* requireActor(headersOf(request)).pipe(Effect.provideContext(services));
        return yield* Effect.provideService(httpEffect, CurrentActor, actor);
      }),
    );
  }),
);

const isClientInputError = (e: unknown) =>
  HttpApiError.HttpApiSchemaError.is(e) && e.kind !== "Body" && e.kind !== "ResponseHeaders";

const reported = new WeakSet<object>();

const markReportable = (reason: Cause.Reason<unknown>) => {
  if (reason._tag === "Interrupt") return false;
  const value = reason._tag === "Fail" ? reason.error : reason.defect;
  if (typeof value !== "object" || value === null) return true;
  if (reported.has(value) || isClientInputError(value) || ErrorReporter.isIgnored(value))
    return false;
  reported.add(value);
  return true;
};

const sentryReporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause, fiber }) => {
    const reportable = cause.reasons.filter(markReportable);
    if (reportable.length === 0) return;
    const request = Context.getOrUndefined(fiber.context, HttpServerRequest.HttpServerRequest);
    const method = request?.method;
    const path = request && new URL(request.url, "http://localhost").pathname;
    settleCause(Cause.fromReasons(reportable), parseClientFacingError, {
      label: `[spaApi] ${method} ${path}`,
      tags: { handler: "spaApi" },
      extra: { method, path },
    });
  },
};

const makeSpaApiHandler = (services: Layer.Layer<AppServices>) =>
  HttpRouter.toWebHandler(
    HttpApiBuilder.layer(SpaApi).pipe(
      Layer.provide([
        AccountHandlers,
        MembershipHandlers,
        CompanyHandlers,
        InvitationHandlers,
        MfaHandlers,
        MfaChallengeHandlers,
      ]),
      Layer.provide(AuthenticatedLive),
      HttpRouter.provideRequest(services),
      Layer.provide(services),
      Layer.provide(ErrorReporter.layer([sentryReporter])),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );

export const runtimeServices = (): Layer.Layer<AppServices> =>
  Layer.effectContext(getRuntime().contextEffect);

export function mountSpaApi(app: Hono, services?: Layer.Layer<AppServices>): void {
  let spaHandler: ReturnType<typeof makeSpaApiHandler> | undefined;
  const respond = (request: Request) => {
    spaHandler ??= makeSpaApiHandler(services ?? runtimeServices());
    return spaHandler.handler(request);
  };
  HttpApi.reflect(SpaApi, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      app.on(endpoint.method, endpoint.path, (c) => respond(c.req.raw));
    },
  });
}
