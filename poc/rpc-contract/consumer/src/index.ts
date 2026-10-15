import { createConnectTransport } from "@connectrpc/connect-web";
import {
  createAuthClient,
  createAuthGuard,
  createServiceKeyInterceptor,
} from "@taimei-code/auth-client";
import type { AuthRpc } from "../../../../src/worker";
import { callC } from "./c-client";
import { type FlowEnv, flows, seedReadModel } from "./flows";
import { issue, verify } from "./v5-token";

type Env = {
  AUTH: Fetcher;
  AUTH_RPC: Service<typeof AuthRpc>;
  SERVICE_KEY: string;
};

const clientOf = (env: Env, useBinaryFormat: boolean) =>
  createAuthClient({
    transport: createConnectTransport({
      baseUrl: "https://taimei-auth/rpc",
      fetch: (input, init) => env.AUTH.fetch(input, { ...init, redirect: "manual" }),
      useBinaryFormat,
      interceptors: [createServiceKeyInterceptor(env.SERVICE_KEY)],
    }),
  });

const callers = {
  a: (env: Env, token: string) => clientOf(env, false).authService.verifySession({ sessionToken: token }),
  abin: (env: Env, token: string) => clientOf(env, true).authService.verifySession({ sessionToken: token }),
  araw: (env: Env, token: string) =>
    env.AUTH.fetch("https://taimei-auth/rpc/auth.v1.AuthService/VerifySession", {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": env.SERVICE_KEY },
      body: JSON.stringify({ sessionToken: token }),
    }).then((r) => r.json()),
  craw: (env: Env, token: string) =>
    env.AUTH.fetch("https://taimei-auth/rpc2/verify-session", {
      method: "POST",
      headers: { "content-type": "application/json", "x-service-key": env.SERVICE_KEY },
      body: JSON.stringify({ sessionToken: token }),
    }).then((r) => r.json()),
  d: (env: Env, token: string) => env.AUTH_RPC.verifySession(token),
  c: (env: Env, token: string) => callC(env.AUTH, env.SERVICE_KEY, token),
} as const;

const nearestRank = (sorted: number[], p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") ?? "";
    const mode = (url.searchParams.get("mode") ?? "a") as keyof typeof callers;

    const cookieHeader = url.searchParams.get("cookie") ?? "";
    const flowMode = (url.searchParams.get("mode") ?? "v1") as keyof typeof flows;
    const flowEnv = env as unknown as FlowEnv;
    if (url.pathname === "/result") {
      return Response.json(await flows[flowMode](flowEnv, cookieHeader));
    }
    if (url.pathname === "/consumer-bad-input") {
      const loose = flowEnv.AUTH_CONSUMER as unknown as { getSession: (v: unknown) => Promise<unknown> };
      const results = [];
      for (const value of [12345, { toString: () => cookieHeader }, "x".repeat(9000)]) {
        results.push(await loose.getSession(value).then((v) => ({ value: v }), (e: unknown) => ({ error: String(e) })));
      }
      return Response.json(results);
    }
    if (url.pathname === "/seed") {
      return Response.json(await seedReadModel(flowEnv, cookieHeader));
    }
    if (url.pathname === "/flow-bench") {
      const n = Number(url.searchParams.get("n") ?? "100");
      const samples: number[] = [];
      for (let i = 0; i < n; i++) {
        const start = performance.now();
        await flows[flowMode](flowEnv, cookieHeader);
        samples.push(performance.now() - start);
      }
      samples.sort((x, y) => x - y);
      return Response.json({ mode: flowMode, n, p50: nearestRank(samples, 50), p95: nearestRank(samples, 95) });
    }
    if (url.pathname === "/v5-issue") {
      const claims = JSON.parse(url.searchParams.get("claims") ?? "{}");
      return Response.json({ token: await issue(claims) });
    }
    if (url.pathname === "/v5-verify") {
      return Response.json(await verify(url.searchParams.get("token") ?? "", Math.floor(Date.now() / 1000)));
    }
    if (url.pathname === "/v5-bench") {
      const n = Number(url.searchParams.get("n") ?? "100");
      const token = url.searchParams.get("token") ?? "";
      let last: unknown;
      for (let i = 0; i < n; i++) last = await verify(token, Math.floor(Date.now() / 1000));
      return Response.json({ n, last });
    }
    if (url.pathname === "/guard") {
      const guard = createAuthGuard({ client: clientOf(env, false), getSessionToken: async () => token });
      return Response.json(await guard.getSession());
    }
    if (url.pathname === "/call") {
      return Response.json(await callers[mode](env, token));
    }
    if (url.pathname === "/members") {
      const result = await env.AUTH_RPC.checkMemberships(url.searchParams.get("company") ?? "", ["u1"]).then(
        (value) => ({ value }),
        (error: unknown) => ({ error: String(error), name: (error as Error).name }),
      );
      return Response.json(result);
    }
    if (url.pathname === "/d-bad-input") {
      const loose = env.AUTH_RPC as unknown as { verifySession: (t: unknown) => Promise<unknown> };
      const result = await loose.verifySession({ toString: () => token }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error: String(error) }),
      );
      return Response.json(result);
    }
    if (url.pathname === "/bench") {
      const n = Number(url.searchParams.get("n") ?? "200");
      const samples: number[] = [];
      for (let i = 0; i < n + 10; i++) {
        const start = performance.now();
        await callers[mode](env, token);
        if (i >= 10) samples.push(performance.now() - start);
      }
      samples.sort((x, y) => x - y);
      return Response.json({ mode, n, p50: nearestRank(samples, 50), p95: nearestRank(samples, 95) });
    }
    return new Response("not found", { status: 404 });
  },
};
