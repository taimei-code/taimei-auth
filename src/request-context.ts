import { isBunRuntime, isLocalEnvironment } from "./env";

// audit ログの ip 欄と IP 軸 rate-limit key の唯一の生成元。client は任意ヘッダを送れるため、信用するのは
// 「経路上の信頼できる主体が上書き / 付け足した位置」だけ (runtime で異なる)。設定は README。
export type ClientContext = { ip: string; userAgent: string };

const UNKNOWN = "unknown";

// 非 production Bun の既定。proxy 無しの直公開だが、テスト / e2e が X-Forwarded-For で client IP を
// 注入して検証するため 1 hop 相当にする。production Bun は index.ts が未設定を boot で拒否する。
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HEXTET = /^[0-9a-fA-F]{1,4}$/;
const BRACKETED_IPV6_WITH_OPTIONAL_PORT = /^\[([^\]]+)\](?::\d+)?$/;
const IPV4_MAPPED_TAIL_GROUPS = 2;
const IPV6_GROUPS = 8;

const isIpv4Literal = (value: string): boolean => IPV4.test(value);

function isIpv6Literal(value: string): boolean {
  const halves = value.split("::");
  if (halves.length > 2) return false;
  let groups = 0;
  for (let h = 0; h < halves.length; h++) {
    const half = halves[h];
    if (half === "") continue;
    const parts = half.split(":");
    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      const isTailGroup = h === halves.length - 1 && p === parts.length - 1;
      if (isTailGroup && part.includes(".")) {
        if (!isIpv4Literal(part)) return false;
        groups += IPV4_MAPPED_TAIL_GROUPS;
        continue;
      }
      if (!HEXTET.test(part)) return false;
      groups += 1;
    }
  }
  // "::" は 1 group 以上の省略を表すため (RFC 4291)、省略ありなら明示 group は 7 以下に収まる。
  return halves.length === 2 ? groups < IPV6_GROUPS : groups === IPV6_GROUPS;
}

// port 付きで書く proxy 実装があるため IPv4 のみ port を落とす (bracket 無し IPv6 は判別不能なので触らない)。
function stripIpv4Port(value: string): string {
  const parts = value.split(":");
  return parts.length === 2 && /^\d+$/.test(parts[1]) ? parts[0] : value;
}

function parseIpLiteral(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bracketed = BRACKETED_IPV6_WITH_OPTIONAL_PORT.exec(trimmed);
  const candidate = bracketed ? bracketed[1] : stripIpv4Port(trimmed);
  if (!candidate) return null;
  return isIpv4Literal(candidate) || isIpv6Literal(candidate) ? candidate : null;
}

// 設定ミス (空文字 / 負数 / 小数) が攻撃者の値を信用する側へ倒れないよう、非負整数以外は null にする。
export function parseTrustedProxyHops(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const hops = Number(trimmed);
  return Number.isSafeInteger(hops) ? hops : null;
}

// X-Forwarded-For は client が先頭へ任意の値を積めるため、末尾から trustedProxyHops 番目 (自前 proxy が
// 付け足した位置) だけを client とみなす。export は Bun global を差し替えられず pure 関数で検証するため。
export function resolveForwardedClientIp(headers: Headers, trustedProxyHops: number): string {
  // hop 0 = proxy 無しの直公開。client IP を名乗るヘッダがすべて client 由来になるため何も信用しない。
  if (trustedProxyHops < 1) return UNKNOWN;

  // x-real-ip は「最も近い proxy が見た peer」で client と一致するのは 1 hop のときだけ。多段では使わない。
  const realIp = trustedProxyHops === 1 ? parseIpLiteral(headers.get("x-real-ip")) : null;

  const forwardedHeader = headers.get("x-forwarded-for");
  // X-Forwarded-For を出さず X-Real-IP だけを立てる proxy 設定があるため、不在時のみそちらへ落とす。
  if (forwardedHeader === null) return realIp ?? UNKNOWN;

  const chain = forwardedHeader.split(",");
  const hopIndex = chain.length - trustedProxyHops;
  const forwardedIp = hopIndex >= 0 ? parseIpLiteral(chain[hopIndex]) : null;
  if (!forwardedIp) return UNKNOWN;

  // 食い違いは X-Forwarded-For が client 注入で伸びた疑い。client が動かせる側を採らず unknown へ倒す。
  if (realIp && realIp !== forwardedIp) return UNKNOWN;
  return forwardedIp;
}

// Cloudflare が edge で必ず上書きするため、この 1 本だけを信用し X-Forwarded-For / X-Real-IP は読まない。
export function resolveCloudflareClientIp(headers: Headers): string {
  return parseIpLiteral(headers.get("cf-connecting-ip")) ?? UNKNOWN;
}

function trustedProxyHopsFromEnv(): number | null {
  const configured = parseTrustedProxyHops(process.env.AUTH_TRUSTED_PROXY_HOPS);
  if (configured !== null) return configured;
  // production の設定漏れは index.ts の boot guard が止める。二重防御として production ではヘッダを信用しない。
  return isLocalEnvironment() ? DEFAULT_TRUSTED_PROXY_HOPS : null;
}

// Bun 判定が先なのは load-bearing: Bun 上では cf-connecting-ip も client が送れるため forwarded 経路へ振る。
function resolveClientIp(headers: Headers): string {
  if (isBunRuntime()) return resolveForwardedClientIp(headers, trustedProxyHopsFromEnv() ?? 0);
  return resolveCloudflareClientIp(headers);
}

export function getClientContext(headers: Headers | null | undefined): ClientContext {
  const userAgent = headers?.get("user-agent") || UNKNOWN;
  return { ip: headers ? resolveClientIp(headers) : UNKNOWN, userAgent };
}
