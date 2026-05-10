import { TAIMEI_SERVICES, type ServiceName } from "./services";

// redirect_url 検証ポリシー: docs/adr/0003-redirect-url-allowlist-policy.md
const ALLOWED_PROTOCOLS = ["http:", "https:"] as const;

export const validateRedirectUrl = (redirectUrl: string, service: ServiceName): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    return false;
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol as (typeof ALLOWED_PROTOCOLS)[number])) {
    return false;
  }

  if (url.username !== "" || url.password !== "") {
    return false;
  }

  const host = url.hostname.replace(/\.$/, "");

  return TAIMEI_SERVICES[service].allowedHostPattern.test(host);
};
