// Cloudflare Workers entry。共有ルートは buildApp (src/app.ts) を使い、
// Workers 固有なのは (1) per-request env からの runtime bootstrap (Hyperdrive / Upstash) と
// (2) 静的配信 = Workers Static Assets (env.ASSETS) のみ。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
import type { Hono } from "hono";
// Workers は request ごとに実 Pool を供給する (理由は db/client.ts / ADR-0011)。
// drizzle-orm / @/db/schema の直 import は worker.ts でも禁止のまま。
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

// 順序は load-bearing: env→process.env コピー → initRedis → initAuth → buildApp。
// initAuth の buildAuth が db (= module ロード時構築済みの routing db) / redisStorage を、
// buildApp が process.env (AUTH_TRUSTED_ORIGINS 等) を読むため、この順序でしか正しく組み上がらない。
// DB の実 Pool は bootstrap で作らず fetch ごとに runWithRequestPool で供給する (理由は db/client.ts)。
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
        const env = c.env as Env;
        const url = new URL(c.req.url);
        // vite base=/auth/ のため index.html は /auth/assets/* を参照する。Workers Static Assets は
        // web/dist を / 直下に配信するので、/auth プレフィックスを剥がして委譲する (Bun index.ts の
        // serveStatic rewriteRequestPath と同じ)。剥がさないと /auth/assets/* が実在せず
        // not_found_handling=single-page-application が index.html (html) を JS として返し画面が
        // 真っ白になる。詳細: docs/adr/0002-spa-routing-and-static-assets.md
        if (url.pathname.startsWith("/auth/")) {
          url.pathname = url.pathname.replace(/^\/auth/, "") || "/";
          return env.ASSETS.fetch(new Request(url, c.req.raw));
        }
        // /account/* 等の deep link は実ファイル無し → SPA fallback で index.html。
        return env.ASSETS.fetch(c.req.raw);
      });
    },
  });
  return app;
}

const handler = {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const app = bootstrap(env);
    // request ごとに実 Pool を作り ALS に載せる。background task (audit log) も同 ALS 内で起動するため
    // 同じ request pool を掴む。Pool は全 background task の完走を待ってから閉じる (早く閉じると
    // ctx.waitUntil 中の DB 書き込みが壊れた接続を掴み再び "hung" になる)。runBackground 登録分を集め、
    // finally で (= response を返す前に) settle 待ち + pool.end() を 1 本の waitUntil に登録する。
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

// @sentry/cloudflare は withSentry で fetch をラップし、リクエストスコープで Sentry client を
// 初期化する。DSN は env (secret) から読み、未設定時は no-op (facade は console fallback のまま)。
// handler が throw した未捕捉例外はここで自動的に Sentry へ送られる。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV ?? "production",
    tracesSampleRate: 0.1,
  }),
  handler,
);
