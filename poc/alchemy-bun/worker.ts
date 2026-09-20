import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import KvStore from "./kv-store.ts";

export default Cloudflare.Worker(
  "PocKvWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const stores = yield* KvStore;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest;
        const url = new URL(request.url, "http://x");
        const stub = stores.getByName(url.searchParams.get("k") ?? "");
        if (url.pathname === "/set") {
          yield* stub.set(url.searchParams.get("v") ?? "", Number(url.searchParams.get("n") ?? 0) || undefined);
          return HttpServerResponse.jsonUnsafe({ ok: true });
        }
        return HttpServerResponse.jsonUnsafe({ v: yield* stub.get() });
      }),
    };
  }),
);
