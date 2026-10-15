import { Effect, flow, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api";
import { ConsumerApi, ServiceKeyAuth } from "../../../../src/rpc/consumer-contract";

export const serviceKeyClient = (serviceKey: string) =>
  HttpApiMiddleware.layerClient(ServiceKeyAuth, ({ next, request }) =>
    next(HttpClientRequest.setHeader(request, "X-Service-Key", serviceKey)),
  );

export const makeConsumerClient = HttpApiClient.make(ConsumerApi, {
  transformClient: HttpClient.mapRequest(flow(HttpClientRequest.prependUrl("https://taimei-auth"))),
});

export const fetchVia = (fetcher: Fetcher) =>
  Layer.mergeAll(
    FetchHttpClient.layer,
    Layer.succeed(FetchHttpClient.Fetch, ((input, init) => fetcher.fetch(input, init)) as typeof fetch),
  );

export const callC = (fetcher: Fetcher, serviceKey: string, sessionToken: string) =>
  Effect.gen(function* () {
    const client = yield* makeConsumerClient;
    return yield* client.consumer.verifySession({ payload: { sessionToken } });
  }).pipe(Effect.provide(serviceKeyClient(serviceKey)), Effect.provide(fetchVia(fetcher)), Effect.runPromise);
