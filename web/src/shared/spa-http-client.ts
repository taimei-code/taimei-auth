import { SpaApi } from "@core/spa-contract";
import { Context, type Effect, Layer, type Schema } from "effect";
import type { HttpClientError } from "effect/http";
// oxlint-disable-next-line no-restricted-imports -- Foldkit の画面の Command が SPA の API の契約から client を作るのはこの file だけ
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
