import { isBunRuntime, isLocalEnvironment } from "./env";

// audit ログの ip 欄と IP 軸の rate-limit key の唯一の生成元。client は任意のヘッダを送れるため、信用するのは
// 経路上の信頼できる主体が上書きまたは付け足した位置だけにする (runtime によって異なる)。設定は README に書く。
export type ClientContext = { ip: string; userAgent: string };

const UNKNOWN = "unknown";

export type ProxyTrust =
  | { readonly _tag: "Unconfigured" }
  | { readonly _tag: "Direct" }
  | { readonly _tag: "BehindProxy"; readonly hops: number };

const UNCONFIGURED: ProxyTrust = { _tag: "Unconfigured" };
const DIRECT: ProxyTrust = { _tag: "Direct" };

// 非 production は proxy を挟まず直接公開するが、テストと e2e が X-Forwarded-For で client IP を注入するため 1 hop 相当にする。
const LOCAL_DEFAULT_PROXY_TRUST: ProxyTrust = { _tag: "BehindProxy", hops: 1 };

const NON_NEGATIVE_INTEGER = /^\d+$/;
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
  // "::" は 1 group 以上の省略を表すため (RFC 4291)、省略があるなら明示された group は 7 以下になる。
  return halves.length === 2 ? groups < IPV6_GROUPS : groups === IPV6_GROUPS;
}

// port 付きで書く proxy 実装があるため IPv4 だけ port を取り除く (bracket 無しの IPv6 は判別できないので触らない)。
function stripIpv4Port(value: string): string {
  const parts = value.split(":");
  return parts.length === 2 && NON_NEGATIVE_INTEGER.test(parts[1]) ? parts[0] : value;
}

function parseIpLiteral(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const bracketed = BRACKETED_IPV6_WITH_OPTIONAL_PORT.exec(trimmed);
  const candidate = bracketed ? bracketed[1] : stripIpv4Port(trimmed);
  if (!candidate) return null;
  return isIpv4Literal(candidate) || isIpv6Literal(candidate) ? candidate : null;
}

export function parseProxyTrust(raw: string | undefined): ProxyTrust {
  if (raw === undefined) return UNCONFIGURED;
  const trimmed = raw.trim();
  if (!NON_NEGATIVE_INTEGER.test(trimmed)) return UNCONFIGURED;
  const hops = Number(trimmed);
  if (!Number.isSafeInteger(hops)) return UNCONFIGURED;
  return hops === 0 ? DIRECT : { _tag: "BehindProxy", hops };
}

// X-Forwarded-For は client が先頭に任意の値を入れられるため、末尾から trust.hops 番目 (自前の proxy が
// 付け足した位置) だけを client とみなす。export するのは、Bun の global を差し替えられずテストが pure 関数として検証するため。
export function resolveForwardedClientIp(headers: Headers, trust: ProxyTrust): string {
  if (trust._tag !== "BehindProxy") return UNKNOWN;

  // x-real-ip は「最も近い proxy から見た peer」であり、client と一致するのは 1 hop のときだけ。多段では使わない。
  const realIp = trust.hops === 1 ? parseIpLiteral(headers.get("x-real-ip")) : null;

  const forwardedHeader = headers.get("x-forwarded-for");
  // X-Forwarded-For を出さず X-Real-IP だけを付ける proxy 設定があるため、X-Forwarded-For が無いときだけそちらを使う。
  if (forwardedHeader === null) return realIp ?? UNKNOWN;

  const chain = forwardedHeader.split(",");
  const hopIndex = chain.length - trust.hops;
  const forwardedIp = hopIndex >= 0 ? parseIpLiteral(chain[hopIndex]) : null;
  if (!forwardedIp) return UNKNOWN;

  // 食い違いがあれば X-Forwarded-For が client の注入で伸びた疑いがある。client が操作できる側を採らず unknown にする。
  if (realIp && realIp !== forwardedIp) return UNKNOWN;
  return forwardedIp;
}

// Cloudflare が edge で必ず上書きするため、このヘッダだけを信用し、X-Forwarded-For と X-Real-IP は読まない。
export function resolveCloudflareClientIp(headers: Headers): string {
  return parseIpLiteral(headers.get("cf-connecting-ip")) ?? UNKNOWN;
}

export function proxyTrustFromEnv(): ProxyTrust {
  const trust = parseProxyTrust(process.env.AUTH_TRUSTED_PROXY_HOPS);
  if (trust._tag !== "Unconfigured") return trust;
  // production での設定漏れは index.ts の boot guard が止める。二重の防御として、production ではヘッダを信用しない。
  return isLocalEnvironment() ? LOCAL_DEFAULT_PROXY_TRUST : UNCONFIGURED;
}

// Bun の判定を先にするのは必須の順序。Bun 上では cf-connecting-ip も client が送れるため、forwarded の経路に回す。
function resolveClientIp(headers: Headers): string {
  if (isBunRuntime()) return resolveForwardedClientIp(headers, proxyTrustFromEnv());
  return resolveCloudflareClientIp(headers);
}

export function getClientContext(headers: Headers | null | undefined): ClientContext {
  const userAgent = headers?.get("user-agent") || UNKNOWN;
  return { ip: headers ? resolveClientIp(headers) : UNKNOWN, userAgent };
}
