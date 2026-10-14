import { Effect, type Exit, type Layer } from "effect";
import { type Context, Hono } from "hono";

export const runProgramInRoute = async <A, E, R>(
  route: string,
  url: string,
  program: (c: Context) => Effect.Effect<A, E, R>,
  layer: Layer.Layer<R>,
  init?: RequestInit,
): Promise<A> => {
  let exit: Exit.Exit<A, E> | undefined;
  const app = new Hono().get(route, async (c) => {
    exit = await Effect.runPromiseExit(Effect.provide(program(c), layer));
    return c.text("ok");
  });
  await app.request(url, init);
  if (!exit) throw new Error(`route ${route} did not match ${url}`);
  return Effect.runSync(exit);
};
