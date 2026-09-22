import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { registerRoutes } from "./routes";

const RPC_PREFIX = "/rpc";

let handlers: Map<string, (req: Request) => Promise<Response>> | null = null;

// auth は ESM の live binding である。module のロード時に事前構築すると auth が undefined のまま map を組むため、lazy にしておく。
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

export async function handleRpc(req: Request): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith(`${RPC_PREFIX}/`)) return null;
  const connectPath = url.pathname.slice(RPC_PREFIX.length); // "/auth.v1.AuthService/SignOut"
  const handler = ensureHandlers().get(connectPath);
  if (!handler) return null;
  // createFetchHandler は handler 自身の requestPath と照合するため、prefix を取り除いた Request を渡す。
  url.pathname = connectPath;
  return handler(new Request(url, req));
}
