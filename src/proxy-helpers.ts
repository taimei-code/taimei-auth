// Hono → Node.js connectNodeAdapter 間のプロキシ用ヘルパー。
// connectNodeAdapter は Content-Length 付きリクエストを期待するが、
// Bun から forward された Headers には元リクエストの transfer-encoding: chunked が
// 残っており、両者の併存は HTTP 仕様違反として 400 を返される。
export function buildProxyHeaders(
  srcHeaders: Headers,
  contentLength?: number
): Headers {
  const out = new Headers(srcHeaders);
  out.delete("transfer-encoding");
  if (contentLength !== undefined) {
    out.set("content-length", String(contentLength));
  }
  return out;
}
