import type { Hono } from "hono";
// biome-ignore lint/style/noRestrictedImports: Workers は per-request に実 Pool を供給する経路だけ許可
import { runWithRequestPool } from "@/db/client";
import { initAuth } from "./auth";
import { KvStore as KvStoreBase } from "./kv-store.do";
import { initRedis, type KvStoreNamespace } from "./redis";
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

let bootstrappedApp: Hono | null = null;

function copyEnvToProcess(env: Env): void {
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
  process.env.CF_VERSION_ID = env.CF_VERSION_METADATA.id;
}

// 順序は load-bearing: env コピー → initRedis → initAuth → buildApp (後者が前者の結果を読む)。
function bootstrap(env: Env): Hono {
  if (bootstrappedApp) return bootstrappedApp;
  copyEnvToProcess(env);
  initCloudflareSentry(env.SENTRY_DSN);
  initRedis(env.KV_STORE);
  initAuth();
  bootstrappedApp = buildApp({
    mountStatic: (app) => {
      app.all("*", (c) => {
        const requestEnv = c.env as Env;
        const url = new URL(c.req.url);
        // Static Assets は / 直下配信なので vite base=/auth/ の prefix を剥がす (残すと JS として index.html)。
        if (url.pathname.startsWith("/auth/")) {
          url.pathname = url.pathname.replace(/^\/auth/, "") || "/";
          return requestEnv.ASSETS.fetch(new Request(url, c.req.raw));
        }
        return requestEnv.ASSETS.fetch(c.req.raw);
      });
    },
  });
  return bootstrappedApp;
}

const handler = {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const app = bootstrap(env);
    // 早く閉じると waitUntil 中の DB 書き込みが壊れた接続を掴み hung するため background 完走後に閉じる。
    const backgroundPromises: Promise<unknown>[] = [];
    return runWithRequestPool(env.HYPERDRIVE.connectionString, async (pool) => {
      try {
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
};

const sentryOptions = (env: Env) => ({
  dsn: env.SENTRY_DSN,
  environment: env.APP_ENV ?? "production",
  tracesSampleRate: 0.1,
});

// ここで拾えるのは Hono の外 (bootstrap / runWithRequestPool) の例外のみ。
export default Sentry.withSentry(sentryOptions, handler);

// alarm の例外は request の外で起きるため、DO 側も同じ option で Sentry に繋ぐ。
export const KvStore = Sentry.instrumentDurableObjectWithSentry(sentryOptions, KvStoreBase);
