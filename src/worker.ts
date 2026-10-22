import type { Layer } from "effect";
import type { Hono } from "hono";
import type { EmailSender } from "./email/ports";
// biome-ignore lint/style/noRestrictedImports: Workers では request ごとに実際の Pool を供給する経路だけを許可する
import { runWithRequestPool } from "@/db/client";
import { boot } from "./boot";
import { KvStore as KvStoreBase } from "./kv-store.do";
import { durableObjectBackend, type KvStoreNamespace } from "./ttl-store";
import { buildApp } from "./app";
import { withWaitUntil } from "./background";
import * as Sentry from "@sentry/cloudflare";
import { initCloudflareSentry } from "./sentry-cloudflare";

type Env = {
  HYPERDRIVE: { connectionString: string };
  KV_STORE: KvStoreNamespace;
  CF_VERSION_METADATA: WorkerVersionMetadata;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  SENTRY_DSN?: string;
  APP_ENV?: string;
  [key: string]: unknown;
};

type ExecutionCtx = { waitUntil: (promise: Promise<unknown>) => void };

const VITE_BASE = "/auth";

let bootstrappedApp: Hono | null = null;

function copyEnvToProcess(env: Env): void {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
  process.env.CF_VERSION_ID = env.CF_VERSION_METADATA.id;
}

export type WorkerOptions = {
  emailSender?: Layer.Layer<EmailSender>;
  extendBeforeStatic?: (app: Hono) => void;
};

function bootstrap(env: Env, options: WorkerOptions): Hono {
  if (bootstrappedApp) return bootstrappedApp;
  copyEnvToProcess(env);
  initCloudflareSentry(env.SENTRY_DSN);
  boot(durableObjectBackend(env.KV_STORE), options.emailSender);
  bootstrappedApp = buildApp({
    mountStatic: (app) => {
      options.extendBeforeStatic?.(app);
      app.all("*", (c) => {
        const requestEnv = c.env as Env;
        const url = new URL(c.req.url);
        if (url.pathname.startsWith(`${VITE_BASE}/`)) {
          url.pathname = url.pathname.slice(VITE_BASE.length) || "/";
          return requestEnv.ASSETS.fetch(new Request(url, c.req.raw));
        }
        return requestEnv.ASSETS.fetch(c.req.raw);
      });
    },
  });
  return bootstrappedApp;
}

export const workerHandler = (
  options: WorkerOptions & { beforeRequest?: (env: Env) => Promise<void> } = {},
) => ({
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const app = bootstrap(env, options);
    const backgroundPromises: Promise<unknown>[] = [];
    return runWithRequestPool(env.HYPERDRIVE.connectionString, async (pool) => {
      try {
        await options.beforeRequest?.(env);
        return await withWaitUntil(
          (promise) => {
            backgroundPromises.push(promise);
          },
          () => app.fetch(req, env, ctx as never),
        );
      } finally {
        ctx.waitUntil(Promise.allSettled(backgroundPromises).then(() => pool.end()));
      }
    });
  },
});

export type WorkerEnv = Env;

export const sentryOptions = (env: Env) => ({
  dsn: env.SENTRY_DSN,
  environment: env.APP_ENV ?? "production",
  tracesSampleRate: 0.1,
});

export default Sentry.withSentry(sentryOptions, workerHandler());

export const KvStore = Sentry.instrumentDurableObjectWithSentry(sentryOptions, KvStoreBase);
