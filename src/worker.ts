import type { Layer } from "effect";
import type { Hono } from "hono";
import type { EmailSender } from "./email/ports";
// biome-ignore lint/style/noRestrictedImports: Workers では request ごとに実際の Pool を供給する経路だけを許可する
import { runWithRequestPool } from "@/db/client";
import { boot } from "./boot";
import { KvStore as KvStoreBase } from "./kv-store.do";
import { durableObjectBackend, type KvStoreNamespace, type TtlStoreBackend } from "./ttl-store";
import { buildApp } from "./app";
import { withWaitUntil } from "./background";
import * as Sentry from "@sentry/cloudflare";
import { initCloudflareSentry } from "./sentry-cloudflare";
import { type SentryEnv, sentryOptions } from "./sentry-options";
import { onceUntilSucceeded } from "./once-until-succeeded";
import { withClientIp } from "./client-ip";
import { resolveCloudflareClientIp } from "./request-context";
import { resolveSecretsBeforeHandler } from "./secret-bindings";

type Env = SentryEnv & {
  HYPERDRIVE: { connectionString: string };
  KV_STORE: KvStoreNamespace;
  CF_VERSION_METADATA: WorkerVersionMetadata;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
};

type ExecutionCtx = { waitUntil: (promise: Promise<unknown>) => void };

const VITE_BASE = "/auth";

type WorkerOptions = {
  emailSender?: Layer.Layer<EmailSender>;
  extendBeforeStatic?: (app: Hono) => void;
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
  let ttlStore: TtlStoreBackend | null = null;
  return (env: Env): Hono => {
    if (bootstrappedApp) return bootstrappedApp;
    copyEnvToProcess(env);
    initCloudflareSentry(process.env.SENTRY_DSN);
    ttlStore ??= durableObjectBackend(env.KV_STORE);
    boot(ttlStore, options.emailSender);
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
  };
};

export const createWorker = (options: WorkerOptions = {}) => {
  const bootstrap = bootstrapOnce(options);
  const beforeFirstRequest = onceUntilSucceeded(
    options.beforeFirstRequest ?? (() => Promise.resolve()),
  );
  const handler = {
    async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
      const app = bootstrap(env);
      const backgroundPromises: Promise<unknown>[] = [];
      return runWithRequestPool(env.HYPERDRIVE.connectionString, async (pool) => {
        try {
          await beforeFirstRequest();
          return await withWaitUntil(
            (promise) => {
              backgroundPromises.push(promise);
            },
            () =>
              app.fetch(
                withClientIp(req, resolveCloudflareClientIp(req.headers)),
                env,
                ctx as never,
              ),
          );
        } finally {
          ctx.waitUntil(Promise.allSettled(backgroundPromises).then(() => pool.end()));
        }
      });
    },
  };
  return resolveSecretsBeforeHandler(
    Sentry.withSentry<Env, unknown, unknown, typeof handler>(sentryOptions, handler),
  );
};

export default createWorker();

export const KvStore = Sentry.instrumentDurableObjectWithSentry(sentryOptions, KvStoreBase);
