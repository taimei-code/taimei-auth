// request header から client IP / userAgent を取り出す共通 helper。
// proxy 前提のため x-forwarded-for を最優先、なければ x-real-ip、それも無ければ "unknown" にする。
export type ClientContext = { ip: string; userAgent: string };

export function getClientContext(headers: Headers | null | undefined): ClientContext {
  const ip =
    headers?.get("x-forwarded-for")?.split(",")[0].trim() || headers?.get("x-real-ip") || "unknown";
  const userAgent = headers?.get("user-agent") || "unknown";
  return { ip, userAgent };
}
