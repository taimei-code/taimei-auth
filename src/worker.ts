// Cloudflare Workers entry。共有ルートは buildApp (src/app.ts) を使い、
// Workers 固有なのは (1) per-request env からの runtime bootstrap (Hyperdrive / Upstash) と
// (2) 静的配信 = Workers Static Assets (env.ASSETS) のみ。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
import type { Hono } from "hono";
// Workers の composition root が runtime bootstrap で initDb を呼ぶ (Bun の index.ts は module ロード時
// auto-init のため不要、ADR-0011)。drizzle-orm / @/db/schema の直 import は worker.ts でも禁止のまま。
// biome-ignore lint/style/noRestrictedImports: 上記のとおり Workers bootstrap での initDb のみ許可
import { initDb } from "@/db/client";
import { initAuth } from "./auth";
import { initRedis } from "./redis";
import { buildApp } from "./app";
import { withWaitUntil } from "./background";

type Env = {
  HYPERDRIVE: { connectionString: string };
  ASSETS: { fetch: (req: Request) => Promise<Response> };
  [key: string]: unknown;
};

type ExecutionCtx = { waitUntil: (promise: Promise<unknown>) => void };

// isolate ごとに 1 度だけ bootstrap し、構築済み app を返す (app 非 null が「init 済み」フラグを兼ねる)。
let app: Hono | null = null;

// 順序は load-bearing: env→process.env コピー → initDb → initRedis → initAuth → buildApp。
// initAuth の buildAuth が db / redisStorage を、buildApp が process.env (AUTH_TRUSTED_ORIGINS 等) を
// 読むため、この順序でしか正しく組み上がらない。
function bootstrap(env: Env): Hono {
  if (app) return app;
  // 文字列 vars/secrets を process.env に写し、既存の process.env.* 参照を Workers でも有効化する。
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") process.env[k] = v;
  }
  initDb(env.HYPERDRIVE.connectionString);
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

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const app = bootstrap(env);
    // 背景タスク (audit / welcome email) を ctx.waitUntil に束縛する (background.ts 参照)。
    return withWaitUntil(
      (promise) => ctx.waitUntil(promise),
      () => app.fetch(req, env, ctx as never),
    );
  },
};
