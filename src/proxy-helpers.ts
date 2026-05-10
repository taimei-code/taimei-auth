// Hono → connectNodeAdapter プロキシ用 Headers 整形。詳細: docs/adr/0001-rpc-proxy-content-length.md
export function buildProxyHeaders(srcHeaders: Headers, contentLength?: number): Headers {
  const out = new Headers(srcHeaders);
  out.delete("transfer-encoding");
  if (contentLength !== undefined) {
    out.set("content-length", String(contentLength));
  }
  return out;
}
