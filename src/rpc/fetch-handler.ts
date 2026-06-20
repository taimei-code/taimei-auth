import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { registerRoutes } from "./routes";

// connect-node の内部 http.createServer proxy を使わず、ConnectRouter を fetch ハンドラとして
// 配信する (ADR-0011)。registerRoutes は無改修で再利用し、worker entry / Bun entry の
// どちらからも使える。本番は /rpc prefix 配下に mount するため、dispatch 時に prefix を剥がす。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md

const RPC_PREFIX = "/rpc";

let handlers: Map<string, (req: Request) => Promise<Response>> | null = null;

// 注意: RPC handler は `auth` (auth.ts の ESM live binding) を参照する。ensureHandlers は lazy で
// 初回リクエスト時に呼ばれ、その時点で worker entry の bootstrap が initAuth 済みのため安全。
// module ロード時に pre-warm すると auth=undefined で map を組んでしまうので、lazy のまま保つ。
function ensureHandlers(): Map<string, (req: Request) => Promise<Response>> {
  if (handlers) return handlers;
  const router = createConnectRouter();
  registerRoutes(router);
  const map = new Map<string, (req: Request) => Promise<Response>>();
  for (const h of router.handlers) {
    map.set(h.requestPath, createFetchHandler(h));
  }
  handlers = map;
  return map;
}

// /rpc/<package>.<Service>/<Method> を受け、prefix を剥がして該当 handler に dispatch する。
// RPC path でない / 未知メソッドなら null を返し、呼出側が後段ルートへ委譲できるようにする。
export async function handleRpc(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${RPC_PREFIX}/`)) return null;
  const connectPath = url.pathname.slice(RPC_PREFIX.length); // "/auth.v1.AuthService/SignOut"
  const handler = ensureHandlers().get(connectPath);
  if (!handler) return null;
  // createFetchHandler は handler 自身の requestPath と request の path を照合するため、
  // prefix を剥がした URL の Request を渡す。
  url.pathname = connectPath;
  return handler(new Request(url, req));
}
