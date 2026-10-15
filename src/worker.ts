import type { Hono } from "hono";
// biome-ignore lint/style/noRestrictedImports: Workers では request ごとに実際の Pool を供給する経路だけを許可する
import { runWithRequestPool } from "@/db/client";
import { boot } from "./boot";
import { WorkerEntrypoint } from "cloudflare:workers";
import { KvStore as KvStoreBase } from "./kv-store.do";
import { verifySessionProgram } from "./rpc/auth-handler";
import { checkMembershipsProgram } from "./rpc/company-handler";
import { runRpc, type RpcEffect } from "./rpc/run-rpc";
import {
  CookieHeader,
  type ConsumerRpcContract,
  GetSessionResult,
  ListMembersResult,
  VerifySessionResult,
} from "./rpc/consumer-rpc-contract";
import {
  getSessionByCookie,
  listMembersByCookie,
  rpc,
  verifySessionByCookie,
} from "./rpc/consumer-rpc";
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

function bootstrap(env: Env): Hono {
  if (bootstrappedApp) return bootstrappedApp;
  copyEnvToProcess(env);
  initCloudflareSentry(env.SENTRY_DSN);
  boot(durableObjectBackend(env.KV_STORE));
  bootstrappedApp = buildApp({
    mountStatic: (app) => {
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

const handler = {
  async fetch(req: Request, env: Env, ctx: ExecutionCtx): Promise<Response> {
    const app = bootstrap(env);
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

export default Sentry.withSentry(sentryOptions, handler);

export const KvStore = Sentry.instrumentDurableObjectWithSentry(sentryOptions, KvStoreBase);

const runInRequest = <A>(env: Env, ctx: ExecutionCtx, program: () => RpcEffect<A>): Promise<A> => {
  bootstrap(env);
  const backgroundPromises: Promise<unknown>[] = [];
  return runWithRequestPool(env.HYPERDRIVE.connectionString, async (pool) => {
    try {
      return await withWaitUntil(
        (promise) => {
          backgroundPromises.push(promise);
        },
        () => runRpc(program()),
      );
    } finally {
      ctx.waitUntil(Promise.allSettled(backgroundPromises).then(() => pool.end()));
    }
  });
};

export class AuthRpc extends WorkerEntrypoint<Env> {
  verifySession(sessionToken: string) {
    return runInRequest(this.env, this.ctx, () => verifySessionProgram({ sessionToken }));
  }

  checkMemberships(companyId: string, userIds: readonly string[]) {
    return runInRequest(this.env, this.ctx, () => checkMembershipsProgram({ companyId, userIds }));
  }
}

const verifySessionRpc = rpc(CookieHeader, VerifySessionResult, verifySessionByCookie);
const listMembersRpc = rpc(CookieHeader, ListMembersResult, listMembersByCookie);
const getSessionRpc = rpc(CookieHeader, GetSessionResult, getSessionByCookie);

export class ConsumerRpc extends WorkerEntrypoint<Env> implements ConsumerRpcContract {
  verifySession(cookieHeader: string) {
    return runInRequest(this.env, this.ctx, () => verifySessionRpc(cookieHeader));
  }

  listCurrentCompanyMembers(cookieHeader: string) {
    return runInRequest(this.env, this.ctx, () => listMembersRpc(cookieHeader));
  }

  getSession(cookieHeader: string) {
    return runInRequest(this.env, this.ctx, () => getSessionRpc(cookieHeader));
  }
}
