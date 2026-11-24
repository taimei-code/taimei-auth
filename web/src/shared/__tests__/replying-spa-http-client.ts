import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import { SpaHttpClient } from "../spa-http-client";

export const replyingSpaHttpClient = () => {
  let reply: () => Promise<Response> = () => Promise.resolve(new Response(null, { status: 500 }));
  const replyingFetch = (() => reply()) as unknown as typeof globalThis.fetch;
  return {
    layer: SpaHttpClient.layer("http://localhost").pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, replyingFetch)),
    ),
    answerWith: (status: number, body?: unknown) => {
      reply = () =>
        Promise.resolve(
          new Response(body === undefined ? null : JSON.stringify(body), {
            status,
            headers: body === undefined ? {} : { "content-type": "application/json" },
          }),
        );
    },
    failToConnect: () => {
      reply = () => Promise.reject(new TypeError("network down"));
    },
  };
};
