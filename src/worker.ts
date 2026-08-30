// Cloudflare Workers entry。共有ルートは buildApp (src/app.ts) で、Workers 固有なのは per-request env
// からの runtime bootstrap と静的配信 (env.ASSETS) のみ。詳細: ADR-0011
import type { Hono } from "hono";
// Workers は request ごとに実 Pool を供給する (理由は db/client.ts / ADR-0011)。drizzle 直 import は禁止のまま。
// biome-ignore lint/style/noRestrictedImports: 上記のとおり Workers の per-request pool 供給のみ許可
import { runWithRequestPool } from "@/db/client";
import { initAuth } from "./auth";
import { initRedis } from "./redis";
import { buildApp } from "./app";
import { withWaitUntil } from "./background";
import * as Sentry from "@sentry/cloudflare";
import { initCloudflareSentry } from "./sentry-cloudflare";

type Env = {
  HYPERDRIVE: { connectionString: string };
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  SENTRY_DSN?: string;
  APP_ENV?: string;
  [key: string]: unknown;
};

type ExecutionCtx = { waitUntil: (promise: Promise<unknown>) => void };

// isolate ごとに 1 度だけ bootstrap し、構築済み app を返す (app 非 null が「init 済み」フラグを兼ねる)。
let app: Hono | null = null;

// 順序は load-bearing: env→process.env コピー → initRedis → initAuth → buildApp (buildAuth が db /
// redisStorage を、buildApp が process.env を読む)。実 Pool は fetch ごとに runWithRequestPool で供給。
function bootstrap(env: Env): Hono {
  if (app) return app;
  // 文字列 vars/secrets を process.env に写し、既存の process.env.* 参照を Workers でも有効化する。
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
  initCloudflareSentry(env.SENTRY_DSN);
  initRedis();
  initAuth();
  app = buildApp({
    mountStatic: (a) => {
      a.all("*", (c) => {
        const requestEnv = c.env as Env;
        const url = new URL(c.req.url);
        // vite base=/auth/ の index.html は /auth/assets/* を参照するが Static Assets は / 直下配信のため
        // prefix を剥がす。剥がさないと SPA fallback が index.html を JS として返し画面が真っ白になる (ADR-0002)。
        if (url.pathname.startsWith("/auth/")) {
          url.pathname = url.pathname.replace(/^\/auth/, "") || "/";
          return requestEnv.ASSETS.fetch(new Request(url, c.req.raw));
        }
        // /account/* 等の deep link は実ファイル無し → SPA fallback で index.html。
        return requestEnv.ASSETS.fetch(c.req.raw);
      });
    },
  });
  return app;
}

const handler = {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const app = bootstrap(env);
    // request ごとに実 Pool を作り ALS に載せる (background task も同 ALS で同じ pool を掴む)。Pool は全
    // background の完走を待って閉じる — 早く閉じると waitUntil 中の DB 書き込みが壊れた接続を掴み hung する。
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

// withSentry が fetch をラップし request スコープで Sentry client を初期化する (DSN 未設定なら no-op)。
// handler の未捕捉例外はここで自動送信される。詳細: ADR-0011
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV ?? "production",
    tracesSampleRate: 0.1,
  }),
  handler,
);
