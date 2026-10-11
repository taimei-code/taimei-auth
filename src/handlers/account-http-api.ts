import { Cause, Effect, ErrorReporter, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerRequest } from "effect/http";
import { HttpApi, HttpApiBuilder, HttpApiError } from "effect/http-api";
import type { Hono } from "hono";
import { type BoundaryError, isBoundaryError } from "../errors";
import { InvitationRepo } from "../invitation/ports";
import { changeRole } from "../membership/change-role";
import {
  requireMembership,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { AccountApi, ActorResolver, Authenticated, CurrentActor } from "../membership/members-api";
import { requireActor } from "../membership/guard/core";
import { MembershipRepo } from "../membership/ports";
import { removeMember } from "../membership/remove";
import { transferOwnership } from "../membership/transfer-ownership";
import type { AuthApi } from "../auth-service";
import { type AppServices, getRuntime } from "../runtime";
import { parseClientFacingError, settleCause } from "./client-facing-error";

const headersOf = (request: HttpServerRequest.HttpServerRequest) =>
  new Headers(request.headers as Record<string, string>);

const dieOnBoundary = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.catchIf((e: E): e is Extract<E, BoundaryError> => isBoundaryError(e), Effect.die),
  );

const MembersHandlers = HttpApiBuilder.group(AccountApi, "members", (handlers) =>
  handlers
    .handle("list", ({ params, request }) =>
      Effect.gen(function* () {
        yield* requireMembership(headersOf(request), params.companyId);
        const memberships = yield* MembershipRepo;
        const members = yield* memberships.findMembersByCompanyId(params.companyId);
        return {
          members: members.map((m) => ({
            membership_id: m.membershipId,
            user_id: m.userId,
            user_name: m.userName,
            user_email: m.userEmail,
            role: m.role,
            joined_at: m.joinedAt.toISOString(),
          })),
        };
      }).pipe(dieOnBoundary),
    )
    .handle("pendingInvitations", ({ params, request }) =>
      Effect.gen(function* () {
        yield* requireMembership(headersOf(request), params.companyId, "ADMIN");
        const invitationRepo = yield* InvitationRepo;
        const invitations = yield* invitationRepo.listPendingInvitations(params.companyId);
        return {
          invitations: invitations.map((inv) => ({
            id: inv.id,
            email: inv.email,
            role: inv.role,
            expires_at: inv.expiresAt.toISOString(),
            created_at: inv.createdAt.toISOString(),
          })),
        };
      }).pipe(dieOnBoundary),
    )
    .handle("changeRole", ({ params, payload, request }) =>
      Effect.gen(function* () {
        const grant = yield* requireRoleChange({
          headers: headersOf(request),
          companyId: params.companyId,
          targetUserId: params.targetUserId,
          parseBody: Effect.succeed({ nextRole: payload.role }),
        });
        yield* changeRole({
          actorUserId: grant.actor.id,
          targetUserId: params.targetUserId,
          companyId: params.companyId,
          beforeRole: grant.targetRole,
          nextRole: grant.nextRole,
        });
        return { ok: true as const };
      }).pipe(dieOnBoundary),
    )
    .handle("remove", ({ params, request }) =>
      Effect.gen(function* () {
        const { actor, targetRole } = yield* requireRemoval({
          headers: headersOf(request),
          companyId: params.companyId,
          targetUserId: params.targetUserId,
        });
        const result = yield* removeMember({
          actorUserId: actor.id,
          targetUserId: params.targetUserId,
          companyId: params.companyId,
          targetRole,
        });
        return { ok: true as const, account_deleted: result.accountDeleted };
      }).pipe(dieOnBoundary),
    )
    .handle("transferOwnership", ({ params, payload, request }) =>
      Effect.gen(function* () {
        const grant = yield* requireTransferOwnership({
          headers: headersOf(request),
          companyId: params.companyId,
          parseBody: Effect.succeed({ toUserId: payload.to_user_id }),
        });
        yield* transferOwnership({
          actorUserId: grant.actor.id,
          toUserId: grant.toUserId,
          companyId: params.companyId,
        });
        return { ok: true as const };
      }).pipe(dieOnBoundary),
    ),
);

const isClientInputError = (e: unknown) =>
  HttpApiError.HttpApiSchemaError.is(e) && e.kind !== "Body" && e.kind !== "ResponseHeaders";

const reported = new WeakSet<object>();

const isFresh = (reason: Cause.Reason<unknown>) => {
  if (reason._tag === "Interrupt") return true;
  const value = reason._tag === "Fail" ? reason.error : reason.defect;
  if (typeof value !== "object" || value === null) return true;
  if (reported.has(value) || isClientInputError(value) || ErrorReporter.isIgnored(value))
    return false;
  reported.add(value);
  return true;
};

const sentryReporter: ErrorReporter.ErrorReporter = {
  [ErrorReporter.TypeId]: ErrorReporter.TypeId,
  report: ({ cause }) => {
    const fresh = cause.reasons.filter(isFresh);
    if (fresh.length === 0) return;
    settleCause(Cause.fromReasons(fresh), parseClientFacingError, {
      label: "[accountApi]",
      tags: { handler: "accountApi" },
    });
  },
};

const AuthenticatedLive = Layer.succeed(Authenticated, (httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const resolver = yield* ActorResolver;
    const actor = yield* resolver.resolve(headersOf(request));
    return yield* Effect.provideService(httpEffect, CurrentActor, actor);
  }),
);

export const makeAccountApiHandler = (services: Layer.Layer<AppServices>) => {
  const actorResolver = Layer.effect(
    ActorResolver,
    Effect.gen(function* () {
      const context = yield* Effect.context<AppServices>();
      return {
        resolve: (headers: Headers) => requireActor(headers).pipe(Effect.provideContext(context)),
      };
    }),
  ).pipe(Layer.provide(services));
  return HttpRouter.toWebHandler(
    HttpApiBuilder.layer(AccountApi).pipe(
      Layer.provide(MembersHandlers),
      Layer.provide(AuthenticatedLive),
      HttpRouter.provideRequest(services),
      Layer.provide(actorResolver),
      Layer.provide(ErrorReporter.layer([sentryReporter])),
      Layer.provide(HttpServer.layerServices),
    ),
    { disableLogger: true },
  );
};

const runtimeServices = () => Layer.effectContext(getRuntime().contextEffect);

let production: ReturnType<typeof makeAccountApiHandler> | undefined;

const respond = async (request: Request, authApiLayer: Layer.Layer<AuthApi> | undefined) => {
  if (authApiLayer === undefined) {
    production ??= makeAccountApiHandler(runtimeServices());
    return production.handler(request);
  }
  const perTest = makeAccountApiHandler(Layer.merge(runtimeServices(), authApiLayer));
  try {
    return await perTest.handler(request);
  } finally {
    await perTest.dispose();
  }
};

export function mountAccountApi(app: Hono): void {
  HttpApi.reflect(AccountApi, {
    onGroup: () => {},
    onEndpoint: ({ endpoint }) => {
      app.on(endpoint.method, endpoint.path, (c) => respond(c.req.raw, c.get("authApiLayer")));
    },
  });
}
