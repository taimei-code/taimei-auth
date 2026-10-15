import { createConnectTransport } from "@connectrpc/connect-web";
import { createAuthClient, createAuthGuard, createServiceKeyInterceptor } from "@taimei-code/auth-client";
import { Schema } from "effect";
import {
  type ConsumerRpcContract,
  GetSessionResult,
  ListMembersResult,
  VerifySessionResult,
} from "../../../../src/rpc/consumer-rpc-contract";

type ReadRpc = {
  getSession(cookieHeader: unknown): Promise<typeof GetSessionResult.Encoded>;
  seed(cookieHeader: string, snapshot: typeof GetSessionResult.Encoded): Promise<void>;
};

export type FlowEnv = {
  AUTH: Fetcher;
  AUTH_CONSUMER: Service<ConsumerRpcContract & Rpc.WorkerEntrypointBranded>;
  AUTH_READ: Service<ReadRpc & Rpc.WorkerEntrypointBranded>;
  SERVICE_KEY: string;
};

export type Normalized =
  | { ok: false; reason: string }
  | {
      ok: true;
      userId: string;
      email: string;
      companyId: string | null;
      role: string | null;
      members: { userId: string; email: string; role: string | null }[];
    };

const memo = <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => {
  let cached: { value: R } | undefined;
  return (...args: Args): R => {
    cached ??= { value: fn(...args) };
    return cached.value;
  };
};

const v1Client = (env: FlowEnv) =>
  createAuthClient({
    transport: createConnectTransport({
      baseUrl: "https://taimei-auth/rpc",
      fetch: (input, init) => env.AUTH.fetch(input, { ...init, redirect: "manual" }),
      interceptors: [createServiceKeyInterceptor(env.SERVICE_KEY)],
    }),
  });

const tokenOf = (cookieHeader: string) =>
  cookieHeader.split(";").map((p) => p.trim()).find((p) => p.startsWith("better-auth.session_token="))?.slice("better-auth.session_token=".length) ?? "";

const v1 = async (env: FlowEnv, cookieHeader: string): Promise<Normalized> => {
  const guard = createAuthGuard({
    client: v1Client(env),
    getSessionToken: async () => tokenOf(cookieHeader),
    cache: memo as never,
  });
  const session = await guard.getSession();
  if (!session.ok) return { ok: false, reason: String(session.reason) };
  const list = await guard.listMembers();
  return {
    ok: true,
    userId: session.data.user.id,
    email: session.data.user.email,
    companyId: session.data.companyId ?? null,
    role: session.data.role ?? null,
    members: list.ok ? list.data.members.map((m) => ({ userId: m.userId, email: m.email, role: m.role ?? null })) : [],
  };
};

const decodeVerify = Schema.decodeUnknownSync(VerifySessionResult);
const decodeList = Schema.decodeUnknownSync(ListMembersResult);
const decodeGet = Schema.decodeUnknownSync(GetSessionResult);

const v2 = async (env: FlowEnv, cookieHeader: string): Promise<Normalized> => {
  const session = decodeVerify(await env.AUTH_CONSUMER.verifySession(cookieHeader));
  if (session._tag !== "Verified") return { ok: false, reason: session._tag === "Rejected" ? session.reason : session._tag };
  const list = decodeList(await env.AUTH_CONSUMER.listCurrentCompanyMembers(cookieHeader));
  const members = list._tag === "Listed" && list.companyId === session.companyId ? list.members : [];
  return {
    ok: true,
    userId: session.user.id,
    email: session.user.email,
    companyId: session.companyId,
    role: session.role,
    members: members.map((m) => ({ userId: m.userId, email: m.email, role: m.role })),
  };
};

const fromGetSession = (raw: unknown): Normalized => {
  const session = decodeGet(raw);
  if (session._tag !== "Verified") return { ok: false, reason: session._tag === "Rejected" ? session.reason : session._tag };
  return {
    ok: true,
    userId: session.user.id,
    email: session.user.email,
    companyId: session.companyId,
    role: session.role,
    members: session.members.map((m) => ({ userId: m.userId, email: m.email, role: m.role })),
  };
};

const v3 = async (env: FlowEnv, cookieHeader: string) => fromGetSession(await env.AUTH_CONSUMER.getSession(cookieHeader));

const v4 = async (env: FlowEnv, cookieHeader: string) => fromGetSession(await env.AUTH_READ.getSession(cookieHeader));

export const flows = { v1, v2, v3, v4 } as const;

export const seedReadModel = async (env: FlowEnv, cookieHeader: string) => {
  const snapshot = await env.AUTH_CONSUMER.getSession(cookieHeader);
  await env.AUTH_READ.seed(cookieHeader, snapshot);
  return snapshot;
};
