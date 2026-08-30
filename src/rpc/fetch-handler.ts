import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { registerRoutes } from "./routes";

// connect-node の内部 http proxy を使わず ConnectRouter を fetch ハンドラとして配信する (ADR-0011)。
// 本番は /rpc prefix 配下に mount するため dispatch 時に prefix を剥がす。

const RPC_PREFIX = "/rpc";

let handlers: Map<string, (req: Request) => Promise<Response>> | null = null;

// RPC handler は auth の ESM live binding を参照する。module ロード時に pre-warm すると auth=undefined
// で map を組むため lazy のまま保つ (初回リクエスト時には bootstrap が initAuth 済み)。
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

// prefix を剥がして dispatch する。RPC path でない / 未知メソッドなら null を返し後段ルートへ委譲させる。
export async function handleRpc(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${RPC_PREFIX}/`)) return null;
  const connectPath = url.pathname.slice(RPC_PREFIX.length); // "/auth.v1.AuthService/SignOut"
  const handler = ensureHandlers().get(connectPath);
  if (!handler) return null;
  // createFetchHandler は handler 自身の requestPath と照合するため prefix を剥がした Request を渡す。
  url.pathname = connectPath;
  return handler(new Request(url, req));
}
