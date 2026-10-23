import { Effect } from "effect";
import type { MiddlewareHandler } from "hono";
import { getAppUrl } from "../src/email/client";
import { Forbidden } from "../src/failures";
import { CONTINUE, runMiddleware } from "../src/handlers/run-route";

const OPAQUE_ORIGIN = "null";

export const ORIGIN_REJECTED_LOG = "auth_host_origin_rejected";

export const authHostOrigin = () => new URL(getAppUrl()).origin;

export const requireAuthHostOrigin: MiddlewareHandler = (c, next) =>
  runMiddleware(
    c,
    next,
    Effect.gen(function* () {
      const expected = yield* Effect.sync(authHostOrigin);
      const received = c.req.header("origin");
      if (expected !== OPAQUE_ORIGIN && received === expected) return CONTINUE;
      yield* Effect.sync(() =>
        console.warn(
          ORIGIN_REJECTED_LOG,
          JSON.stringify({ method: c.req.method, path: c.req.path, received, expected }),
        ),
      );
      return yield* new Forbidden();
    }),
  );
