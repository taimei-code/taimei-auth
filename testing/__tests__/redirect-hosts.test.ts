import { describe, expect, test } from "bun:test";
import { ALLOWED_REDIRECT_HOST_PATTERNS } from "../redirect-hosts";

const STAGING_HOSTS = {
  taimei: "taimei-staging.taimei-staging.workers.dev",
  accounts: "taimei-auth-staging.taimei-staging.workers.dev",
} as const;

describe("本番以外の redirect 先は、staging の host を完全一致でだけ許す", () => {
  test.each(Object.entries(STAGING_HOSTS))("%s の staging の host %s を許す", (service, host) => {
    expect(ALLOWED_REDIRECT_HOST_PATTERNS[service as keyof typeof STAGING_HOSTS].test(host)).toBe(
      true,
    );
  });

  test.each(
    Object.values(STAGING_HOSTS).flatMap((host) => [
      `evil.${host}`,
      `x${host}`,
      `${host}.evil.com`,
      host.replace("taimei-staging.workers.dev", "other.workers.dev"),
    ]),
  )("%s はどの service にも許さない", (host) => {
    expect(
      Object.values(ALLOWED_REDIRECT_HOST_PATTERNS).some((pattern) => pattern.test(host)),
    ).toBe(false);
  });
});
