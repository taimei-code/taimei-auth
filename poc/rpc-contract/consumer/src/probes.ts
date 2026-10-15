import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport, type ConnectRouter } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { createAuthClient } from "@taimei-code/auth-client";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  AuthService,
  CheckMembershipsResponseSchema,
  CompanyService,
} from "../../../../src/gen/auth/v1/auth_pb";
import { ConsumerApi } from "../../../../src/rpc/consumer-contract";
import type { AuthRpc } from "../../../../src/worker";
import { fetchVia, makeConsumerClient, serviceKeyClient } from "./c-client";

declare const fetcher: Fetcher;
declare const rpc: Service<typeof AuthRpc>;

const a = createAuthClient({ transport: createConnectTransport({ baseUrl: "https://x/rpc" }) });

export const probeA = async () => {
  // @ts-expect-error K1
  await a.authService.verifySesion({ sessionToken: "t" });
  // @ts-expect-error K2
  await a.authService.verifySession({ sessionToken: 1 });
  const res = await a.authService.verifySession({ sessionToken: "t" });
  // @ts-expect-error K3
  res.outcome.value.user;
  await a.companyService.checkMemberships({ companyId: "c", userIds: [] }).catch((e: unknown) => {
    // @ts-expect-error K6
    if (e instanceof ConnectError && e.code === Code.NotFound) return null;
    throw e;
  });
};

export const serverA = (router: ConnectRouter) => {
  // @ts-expect-error K4
  router.service(AuthService, { verifySession: async () => ({}) });
  router.service(CompanyService, {
    // @ts-expect-error K5
    checkMemberships: async () => ({ companyActiv: true }),
  });
  router.service(CompanyService, {
    checkMemberships: async () => create(CheckMembershipsResponseSchema, { companyActive: true }),
  });
};

export const probeAS3 = () =>
  // @ts-expect-error S3
  createAuthClient({ transport: createConnectTransport({ baseUrl: "https://x/rpc" }) });

export const unusedRouterTransport = createRouterTransport;

const cProgram = Effect.gen(function* () {
  const client = yield* makeConsumerClient;
  // @ts-expect-error K1
  yield* client.consumer.verifySesion({ payload: { sessionToken: "t" } });
  // @ts-expect-error K2
  yield* client.consumer.verifySession({ payload: { sessionToken: 1 } });
  const res = yield* client.consumer.verifySession({ payload: { sessionToken: "t" } });
  // @ts-expect-error K3
  res.user;
  yield* client.consumer
    .checkMemberships({ payload: { companyId: "c", userIds: [] } })
    // @ts-expect-error K6
    .pipe(Effect.catchTag("NotFound", () => Effect.void));
});

export const probeC = cProgram;
const cClean = Effect.gen(function* () {
  const client = yield* makeConsumerClient;
  return yield* client.consumer.verifySession({ payload: { sessionToken: "t" } });
});
export const probeCWithKey = cClean.pipe(Effect.provide(serviceKeyClient("k")), Effect.provide(fetchVia(fetcher)), Effect.runPromise);
// @ts-expect-error S3
export const probeCS3 = cClean.pipe(Effect.provide(fetchVia(fetcher)), Effect.runPromise);

// @ts-expect-error K4
export const serverCK4 = HttpApiBuilder.group(ConsumerApi, "consumer", (h) => h.handleAll({ verifySession: () => Effect.die("x") }));
export const serverCK5 = HttpApiBuilder.group(ConsumerApi, "consumer", (h) =>
  h.handleAll({
    verifySession: () => Effect.die("x"),
    // @ts-expect-error K5
    checkMemberships: () => Effect.succeed({ companyActiv: true, memberUserIds: [] }),
  }),
);

export const probeD = async () => {
  // @ts-expect-error K1
  await rpc.verifySesion("t");
  // @ts-expect-error K2
  await rpc.verifySession(1);
  const res = await rpc.verifySession("t");
  // @ts-expect-error K3
  res.outcome.value.user;
  await rpc.checkMemberships("", []).catch((e: unknown) => {
    // @ts-expect-error K6
    if (e instanceof Error && e.message.includes("[not_found]")) return null;
    throw e;
  });
};
