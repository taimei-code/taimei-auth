const APP_ENVS_OUTSIDE_PRODUCTION: ReadonlySet<string | undefined> = new Set([
  "development",
  "test",
]);

export const OUTSIDE_PRODUCTION_ONLY =
  "FATAL: testing/worker.ts serves requests only with APP_ENV=development or APP_ENV=test.";

type FetchHandler<Env extends { APP_ENV?: string }, Ctx> = {
  fetch: (req: Request, env: Env, ctx: Ctx) => Promise<Response>;
};

export const serveOnlyOutsideProduction = <Env extends { APP_ENV?: string }, Ctx>(
  handler: FetchHandler<Env, Ctx>,
): FetchHandler<Env, Ctx> => ({
  fetch: async (req, env, ctx) =>
    APP_ENVS_OUTSIDE_PRODUCTION.has(env.APP_ENV)
      ? handler.fetch(req, env, ctx)
      : new Response(OUTSIDE_PRODUCTION_ONLY, { status: 500 }),
});
