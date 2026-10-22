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

type WorkerOptions = {
  emailSender?: Layer.Layer<EmailSender>;
  routesBeforeStatic?: (app: Hono) => void;
  beforeFirstRequest?: () => Promise<void>;
};

function copyEnvToProcess(env: Env): void {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
  process.env.CF_VERSION_ID = env.CF_VERSION_METADATA.id;
}

const bootstrapOnce = (options: WorkerOptions) => {
  let bootstrappedApp: Hono | null = null;
  return (env: Env): Hono => {
    if (bootstrappedApp) return bootstrappedApp;
    copyEnvToProcess(env);
    initCloudflareSentry(env.SENTRY_DSN);
    boot(durableObjectBackend(env.KV_STORE), options.emailSender);
    bootstrappedApp = buildApp({
      mountStatic: (app) => {
        options.routesBeforeStatic?.(app);
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
  };
};

const onceUntilSucceeded = (run: () => Promise<void>) => {
  let succeeded: Promise<void> | null = null;
  return (): Promise<void> => {
    succeeded ??= run().catch((cause: unknown) => {
      succeeded = null;
      throw cause;
    });
    return succeeded;
  };
};

const sentryOptions = (env: Env) => ({
  dsn: env.SENTRY_DSN,
  environment: env.APP_ENV ?? "production",
  tracesSampleRate: 0.1,
});

export const createWorker = (options: WorkerOptions = {}) => {
  const bootstrap = bootstrapOnce(options);
  const beforeFirstRequest = options.beforeFirstRequest
    ? onceUntilSucceeded(options.beforeFirstRequest)
    : null;
  return Sentry.withSentry(sentryOptions, {
    async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
      const app = bootstrap(env);
      const backgroundPromises: Promise<unknown>[] = [];
      return runWithRequestPool(env.HYPERDRIVE.connectionString, async (pool) => {
        try {
          await beforeFirstRequest?.();
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
};

export default createWorker();

export const KvStore = Sentry.instrumentDurableObjectWithSentry(sentryOptions, KvStoreBase);
