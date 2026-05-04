import { TAIMEI_SERVICES, type ServiceName } from "./services";

// validateRedirectUrl: redirect_url の host が指定 service の allowedHostPattern に一致するか検証。
// JavaScript の URL parser は IDN を Punycode に自動正規化するため、Cyrillic homograph (а) は xn-- で始まる
// hostname になり regex 不一致で弾かれる。同様に大文字 host も小文字化される (URL spec)。
// 末尾ドット (app.taimei-code.com.) は parser が保持する場合があるため明示的に除去する。
const ALLOWED_PROTOCOLS = ["http:", "https:"] as const;

export const validateRedirectUrl = (
  redirectUrl: string,
  service: ServiceName
): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    return false;
  }

  // protocol whitelist: javascript: / data: / file: / ftp: 等のスマグリングを拒否
  if (!ALLOWED_PROTOCOLS.includes(url.protocol as (typeof ALLOWED_PROTOCOLS)[number])) {
    return false;
  }

  // userinfo (https://app.taimei-code.com@evil.com/) は弾く。
  // host は実際 evil.com になるので allowlist 検証で弾かれるが、明示拒否で意図しない解釈を防ぐ。
  if (url.username !== "" || url.password !== "") {
    return false;
  }

  // 末尾ドット除去 (FQDN 表記の正規化)
  const host = url.hostname.replace(/\.$/, "");

  return TAIMEI_SERVICES[service].allowedHostPattern.test(host);
};
