import { SpaApi } from "@core/spa-contract";
import { Unauthorized } from "@core/failures";
import { Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi } from "effect/reactivity";

import { leaveSpaToSignIn } from "./leave-spa";

export const leaveForSignInOnUnauthorized = <A, E, R>(
  response: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.tapError(response, (failure) =>
    Schema.is(Unauthorized)(failure) ? Effect.sync(leaveSpaToSignIn) : Effect.void,
  );

export class SpaApiClient extends AtomHttpApi.Service<SpaApiClient>()("SpaApiClient", {
  api: SpaApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: globalThis.location?.origin,
  transformResponse: leaveForSignInOnUnauthorized,
}) {}
