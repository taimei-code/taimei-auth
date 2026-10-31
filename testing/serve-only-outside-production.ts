const APP_ENVS_OUTSIDE_PRODUCTION: ReadonlySet<string | undefined> = new Set([
  "development",
  "test",
  "staging",
]);

export const OUTSIDE_PRODUCTION_ONLY_MESSAGE =
  "FATAL: the non-production entries serve requests only with APP_ENV=development, APP_ENV=test, or APP_ENV=staging.";

export const isOutsideProduction = (appEnv: string | undefined): boolean =>
  APP_ENVS_OUTSIDE_PRODUCTION.has(appEnv);

export type FetchHandler<Env, Ctx> = {
  fetch: (req: Request, env: Env, ctx: Ctx) => Promise<Response>;
};

export const serveOnlyOutsideProduction = <Env extends { APP_ENV?: string }, Ctx>(
  handler: FetchHandler<Env, Ctx>,
): FetchHandler<Env, Ctx> => ({
  fetch: async (req, env, ctx) =>
    isOutsideProduction(env.APP_ENV)
      ? handler.fetch(req, env, ctx)
      : new Response(OUTSIDE_PRODUCTION_ONLY_MESSAGE, { status: 500 }),
});
