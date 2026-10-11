import { SpaApi } from "@core/spa-contract";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi } from "effect/reactivity";

export class SpaApiClient extends AtomHttpApi.Service<SpaApiClient>()("SpaApiClient", {
  api: SpaApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: globalThis.location?.origin,
}) {}
