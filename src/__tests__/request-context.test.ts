import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { grepFiles } from "./grep-files";
import {
  getClientContext,
  parseProxyTrust,
  type ProxyTrust,
  resolveCloudflareClientIp,
  resolveForwardedClientIp,
} from "../request-context";

const UNCONFIGURED: ProxyTrust = { _tag: "Unconfigured" };
const DIRECT: ProxyTrust = { _tag: "Direct" };
const BEHIND_1: ProxyTrust = { _tag: "BehindProxy", hops: 1 };
const BEHIND_2: ProxyTrust = { _tag: "BehindProxy", hops: 2 };

type HopsCase = { name: string; raw: string | undefined; trust: ProxyTrust };

const HOPS_CASES: HopsCase[] = [
  { name: "未設定 (undefined)", raw: undefined, trust: UNCONFIGURED },
  { name: "空文字", raw: "", trust: UNCONFIGURED },
  { name: "空白のみ", raw: "  ", trust: UNCONFIGURED },
  { name: "負数 -1", raw: "-1", trust: UNCONFIGURED },
  { name: "小数 1.5", raw: "1.5", trust: UNCONFIGURED },
  { name: "指数表記 1e3", raw: "1e3", trust: UNCONFIGURED },
  { name: "非数値 many", raw: "many", trust: UNCONFIGURED },
  { name: "16 進 0x2", raw: "0x2", trust: UNCONFIGURED },
  { name: "safe integer 超過", raw: "9007199254740993", trust: UNCONFIGURED },
  { name: "0 (proxy 無し)", raw: "0", trust: DIRECT },
  { name: "1", raw: "1", trust: BEHIND_1 },
  { name: "前後空白付き ' 2 '", raw: " 2 ", trust: BEHIND_2 },
];

describe("parseProxyTrust (AUTH_TRUSTED_PROXY_HOPS の解釈)", () => {
  test.each(HOPS_CASES)("$name → $trust._tag", ({ raw, trust }: HopsCase) => {
    expect(parseProxyTrust(raw)).toEqual(trust);
  });
});

describe("AUTH_TRUSTED_PROXY_HOPS の封じ込め (静的 tripwire)", () => {
  test("env を読む production file は request-context.ts だけ (boot guard も proxyTrustFromEnv を通る)", () => {
    expect(
      grepFiles("process\\.env\\.AUTH_TRUSTED_PROXY_HOPS", "src", { excludeTests: true }),
    ).toEqual(["src/request-context.ts"]);
  });
});

describe("resolveForwardedClientIp (Bun: X-Forwarded-For を末尾から数える)", () => {
  test("proxy 1 段が付け足した単一要素をそのまま採る", () => {
    expect(
      resolveForwardedClientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), BEHIND_1),
    ).toBe("203.0.113.9");
  });

  test("client が先頭へ積んだ値は採らず、proxy が付け足した末尾を採る", () => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.5, 198.51.100.7, 203.0.113.9" });
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("203.0.113.9");
  });

  test("hop 2 段では末尾から 2 番目 (内側 proxy が見た peer) を採る", () => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.5, 203.0.113.9, 198.51.100.7" });
    expect(resolveForwardedClientIp(headers, BEHIND_2)).toBe("203.0.113.9");
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("198.51.100.7");
  });

  test("列が hop 数より短ければ unknown (client が削った / proxy 構成不一致)", () => {
    expect(
      resolveForwardedClientIp(new Headers({ "x-forwarded-for": "203.0.113.9" }), BEHIND_2),
    ).toBe("unknown");
  });

  test.each([
    DIRECT,
    UNCONFIGURED,
  ])("BehindProxy 以外 ($_tag) はヘッダを一切信用しない", (trust) => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" });
    expect(resolveForwardedClientIp(headers, trust)).toBe("unknown");
  });

  test("X-Forwarded-For 不在なら 1 hop に限り X-Real-IP へ落とす", () => {
    const headers = new Headers({ "x-real-ip": "203.0.113.9" });
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("203.0.113.9");
    expect(resolveForwardedClientIp(headers, BEHIND_2)).toBe("unknown");
  });

  test("X-Real-IP と食い違う X-Forwarded-For は採らず unknown", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9, 10.0.0.5",
      "x-real-ip": "203.0.113.9",
    });
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("unknown");
  });

  test("cf-connecting-ip は Bun では client が送れるため読まない", () => {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.9" });
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("unknown");
  });

  test("bracket + port 付き IPv6 は literal 部分を採る", () => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.5, [2001:db8::1]:443" });
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("2001:db8::1");
  });

  test("port 付き IPv4 と前後空白を正規化する", () => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.5 ,  203.0.113.9:54321 " });
    expect(resolveForwardedClientIp(headers, BEHIND_1)).toBe("203.0.113.9");
  });

  const MALFORMED = [
    { name: "空ヘッダ", value: "" },
    { name: "空要素で終わる列", value: "203.0.113.9, " },
    { name: "ホスト名", value: "proxy.internal" },
    { name: "octet 超過", value: "999.0.113.9" },
    { name: "IP 風の任意文字列", value: "203.0.113.9-forged" },
    { name: "group 過多 IPv6", value: "2001:db8:0:0:0:0:0:0:1" },
    { name: "'::' 2 個の IPv6", value: "2001::db8::1" },
    { name: "SQL 断片", value: "203.0.113.9' OR 1=1--" },
  ];
  test.each(MALFORMED)("IP literal として読めない値は unknown: $name", ({ value }) => {
    expect(resolveForwardedClientIp(new Headers({ "x-forwarded-for": value }), BEHIND_1)).toBe(
      "unknown",
    );
  });

  const VALID_LITERALS = ["203.0.113.9", "0.0.0.0", "255.255.255.255", "2001:db8::1", "::1"];
  test.each(VALID_LITERALS)("正規の IP literal は保持する: %s", (value: string) => {
    expect(resolveForwardedClientIp(new Headers({ "x-forwarded-for": value }), BEHIND_1)).toBe(
      value,
    );
  });
});

describe("resolveCloudflareClientIp (Workers: cf-connecting-ip のみ)", () => {
  test("cf-connecting-ip を採る", () => {
    expect(resolveCloudflareClientIp(new Headers({ "cf-connecting-ip": "203.0.113.9" }))).toBe(
      "203.0.113.9",
    );
  });

  test("cf-connecting-ip 不在なら X-Forwarded-For / X-Real-IP があっても unknown", () => {
    const headers = new Headers({ "x-forwarded-for": "10.0.0.5", "x-real-ip": "10.0.0.5" });
    expect(resolveCloudflareClientIp(headers)).toBe("unknown");
  });

  test("IP literal でない cf-connecting-ip は unknown", () => {
    expect(resolveCloudflareClientIp(new Headers({ "cf-connecting-ip": "forged" }))).toBe(
      "unknown",
    );
  });
});

describe("getClientContext (bun test = Bun runtime)", () => {
  const ENV_KEYS = ["AUTH_TRUSTED_PROXY_HOPS", "APP_ENV"] as const;
  const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeEach(() => {
    delete process.env.AUTH_TRUSTED_PROXY_HOPS;
  });

  // process.env の丸ごと置換は Bun.env と desync する (Bun 1.4 で実測) ため key 単位で戻す。
  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test("非 production の既定 (1 hop) で単一要素の X-Forwarded-For を採る", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9", "user-agent": "probe/1.0" });
    expect(getClientContext(headers)).toEqual({ ip: "203.0.113.9", userAgent: "probe/1.0" });
  });

  test("AUTH_TRUSTED_PROXY_HOPS を設定すると数える位置が変わる", () => {
    process.env.AUTH_TRUSTED_PROXY_HOPS = "2";
    const headers = new Headers({ "x-forwarded-for": "10.0.0.5, 203.0.113.9, 198.51.100.7" });
    expect(getClientContext(headers).ip).toBe("203.0.113.9");
  });

  test("AUTH_TRUSTED_PROXY_HOPS=0 (直公開) は非 production でも既定 1 hop に落ちず unknown", () => {
    process.env.AUTH_TRUSTED_PROXY_HOPS = "0";
    expect(getClientContext(new Headers({ "x-forwarded-for": "203.0.113.9" })).ip).toBe("unknown");
  });

  test("production で未設定なら既定に落ちず unknown", () => {
    process.env.APP_ENV = "production";
    expect(getClientContext(new Headers({ "x-forwarded-for": "203.0.113.9" })).ip).toBe("unknown");
  });

  test("Bun では cf-connecting-ip を詐称しても採られない", () => {
    expect(getClientContext(new Headers({ "cf-connecting-ip": "203.0.113.9" })).ip).toBe("unknown");
  });

  test("headers 不在 / ヘッダ無しは unknown", () => {
    expect(getClientContext(null)).toEqual({ ip: "unknown", userAgent: "unknown" });
    expect(getClientContext(new Headers())).toEqual({ ip: "unknown", userAgent: "unknown" });
  });
});
