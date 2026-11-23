import { SpaApi } from "@core/spa-contract";
import { Context, type Effect, Layer, type Schema } from "effect";
import type { HttpClientError } from "effect/http";
import { HttpApiClient } from "effect/http-api";
import { Http } from "foldkit";

type SpaClient = HttpApiClient.ForApi<typeof SpaApi>;

export class SpaHttpClient extends Context.Service<SpaHttpClient, SpaClient>()("SpaHttpClient") {
  static readonly layer = (baseUrl: string) =>
    Layer.effect(SpaHttpClient, HttpApiClient.make(SpaApi, { baseUrl })).pipe(
      Layer.provide(Http.layer),
    );
}

type TransportFailure = HttpClientError.HttpClientError | Schema.SchemaError;

export type DeclaredFailure<
  Group extends keyof SpaClient,
  Endpoint extends keyof SpaClient[Group],
> = SpaClient[Group][Endpoint] extends (...args: never) => Effect.Effect<unknown, infer E, unknown>
  ? Exclude<E, TransportFailure>
  : never;
