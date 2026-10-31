import { ALLOWED_REDIRECT_PROTOCOLS } from "@core/redirect-hosts";
import type { FetchHandler } from "./serve-only-outside-production";

export const REDIRECT_HOSTS_NOT_SWAPPED_IN_WORKER =
  "FATAL: the non-production worker entries (testing/worker.ts, testing/staging-worker.ts) must be built with --config testing/wrangler.jsonc (its alias swaps the redirect allowlist).";

export const REDIRECT_HOSTS_NOT_SWAPPED_IN_SERVER =
  "FATAL: testing/server.ts must start with --preload=./testing/redirect-hosts-plugin.ts; without it the production redirect allowlist rejects local hosts.";

export const usesNonProductionRedirectHosts = (): boolean =>
  ALLOWED_REDIRECT_PROTOCOLS.includes("http:");

export const serveOnlyWithNonProductionRedirectHosts = <Env, Ctx>(
  inEffect: () => boolean,
  handler: FetchHandler<Env, Ctx>,
): FetchHandler<Env, Ctx> => ({
  fetch: async (req, env, ctx) =>
    inEffect()
      ? handler.fetch(req, env, ctx)
      : new Response(REDIRECT_HOSTS_NOT_SWAPPED_IN_WORKER, { status: 500 }),
});
