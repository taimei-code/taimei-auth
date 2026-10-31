import type * as ProductionRedirectHosts from "../src/redirect-hosts";

export const ALLOWED_REDIRECT_PROTOCOLS: typeof ProductionRedirectHosts.ALLOWED_REDIRECT_PROTOCOLS =
  ["http:", "https:"];

export const ALLOWED_REDIRECT_HOST_PATTERNS: typeof ProductionRedirectHosts.ALLOWED_REDIRECT_HOST_PATTERNS =
  {
    taimei:
      /^app\.taimei-code\.(com|localhost)$|^localhost$|^taimei-staging\.taimei-staging\.workers\.dev$/,
    accounts:
      /^auth\.taimei-code\.(com|localhost)$|^localhost$|^taimei-auth-staging\.taimei-staging\.workers\.dev$/,
  };
