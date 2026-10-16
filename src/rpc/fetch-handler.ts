import { createConnectRouter } from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { AUTH_RPC_PATH } from "@taimei-code/auth-client";
import { registerRoutes } from "./routes";

let handlers: Map<string, (req: Request) => Promise<Response>> | null = null;

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
  if (!url.pathname.startsWith(`${AUTH_RPC_PATH}/`)) return null;
  const connectPath = url.pathname.slice(AUTH_RPC_PATH.length);
  const handler = ensureHandlers().get(connectPath);
  if (!handler) return null;
  url.pathname = connectPath;
  return handler(new Request(url, req));
}
