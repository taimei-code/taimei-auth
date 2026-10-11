import { AccountApi } from "@core/membership/members-api";
import { FetchHttpClient } from "effect/http";
import { AtomHttpApi } from "effect/reactivity";

export class AccountApiClient extends AtomHttpApi.Service<AccountApiClient>()("AccountApiClient", {
  api: AccountApi,
  httpClient: FetchHttpClient.layer,
  baseUrl: globalThis.location?.origin,
}) {}
