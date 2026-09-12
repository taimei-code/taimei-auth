import type { Cause } from "effect";
import { Effect, Exit } from "effect";
import type { Context, Next } from "hono";
import { type AppServices, getRuntime } from "../runtime";
import {
  internalErrorResponse,
  parseWireShaped,
  type RouteError,
  settleCause,
  wireErrorResponse,
} from "./wire-error";

export type RouteEffect<A> = Effect.Effect<A, RouteError, AppServices>;

export async function runRoute(c: Context, program: RouteEffect<Response>): Promise<Response> {
  const exit = await getRuntime().runPromiseExit(program);
  if (Exit.isSuccess(exit)) return exit.value;
  return causeToResponse(c, exit.cause, "runRoute");
}

export async function runMiddleware(
  c: Context,
  next: Next,
  program: RouteEffect<Response | undefined>,
): Promise<Response | undefined> {
  const exit = await getRuntime().runPromiseExit(program);
  if (!Exit.isSuccess(exit)) return causeToResponse(c, exit.cause, "runMiddleware");
  if (exit.value) return exit.value;
  await next();
  return undefined;
}

type Adapter = "runRoute" | "runMiddleware";

function causeToResponse(c: Context, cause: Cause.Cause<RouteError>, adapter: Adapter): Response {
  const { failure } = settleCause(cause, parseWireShaped, {
    label: `[${adapter}] ${c.req.method} ${c.req.path}`,
    tags: { handler: adapter },
    extra: { method: c.req.method, path: c.req.path },
  });
  const res = failure ? wireErrorResponse(failure) : internalErrorResponse();
  // program が c.header() で staged した header を error 応答にも載せる (c.newResponse が staged に重ねる)。
  return c.newResponse(res.body, res);
}
