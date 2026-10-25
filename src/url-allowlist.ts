import { ALLOWED_REDIRECT_PROTOCOLS } from "@core/redirect-hosts";
import { TAIMEI_SERVICES, type ServiceName } from "./services";

export const validateRedirectUrl = (redirectUrl: string, service: ServiceName): boolean => {
  let url: URL;
  try {
    url = new URL(redirectUrl);
  } catch {
    return false;
  }

  if (!ALLOWED_REDIRECT_PROTOCOLS.includes(url.protocol)) {
    return false;
  }

  const hasEmbeddedCredentials = url.username !== "" || url.password !== "";
  if (hasEmbeddedCredentials) {
    return false;
  }

  const host = url.hostname.replace(/\.$/, "");

  return TAIMEI_SERVICES[service].allowedHostPattern.test(host);
};
