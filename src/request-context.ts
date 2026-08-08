export type ClientContext = { ip: string; userAgent: string };

// proxy 経由の受信を前提に x-forwarded-for を最優先する (直結時のみ x-real-ip にフォールバック)。
export function getClientContext(headers: Headers | null | undefined): ClientContext {
  const ip =
    headers?.get("x-forwarded-for")?.split(",")[0].trim() || headers?.get("x-real-ip") || "unknown";
  const userAgent = headers?.get("user-agent") || "unknown";
  return { ip, userAgent };
}
