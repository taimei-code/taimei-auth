import { SpaApi } from "@core/spa-contract";
import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";

import { SPA_CLIENT_OPTIONS } from "./spa-api-client";

export class SpaHttpClient extends Context.Service<
  SpaHttpClient,
  HttpApiClient.ForApi<typeof SpaApi>
>()("SpaHttpClient") {
  static readonly layer = Layer.effect(this, HttpApiClient.make(SpaApi, SPA_CLIENT_OPTIONS)).pipe(
    Layer.provide(FetchHttpClient.layer),
  );
}

type TransportFailure = HttpClientError.HttpClientError | Schema.SchemaError;

const isTransportFailure = (failure: unknown): failure is TransportFailure =>
  HttpClientError.isHttpClientError(failure) || Schema.isSchemaError(failure);

export const declaredFailuresOnly = <A, E, R>(
  response: Effect.Effect<A, E | TransportFailure, R>,
): Effect.Effect<A, E, R> => Effect.catchIf(response, isTransportFailure, Effect.die);
