import { afterEach, expect, test } from "bun:test";
import { sentryOptions } from "../sentry-options";

const savedDsn = process.env.SENTRY_DSN;

afterEach(() => {
  if (savedDsn === undefined) delete process.env.SENTRY_DSN;
  else process.env.SENTRY_DSN = savedDsn;
});

test("env の SENTRY_DSN が Secrets Store の binding でも、それを DSN に渡さず、解いた後の文字列を渡す", () => {
  process.env.SENTRY_DSN = "https://public@example.com/4";

  const options = sentryOptions({ SENTRY_DSN: { get: async () => "unused" } });

  expect(options.dsn).toBe("https://public@example.com/4");
});

test("DSN を解く前の isolate (Worker と別の isolate の Durable Object など) では DSN を渡さず、Sentry は送らない", () => {
  delete process.env.SENTRY_DSN;

  expect(sentryOptions({ SENTRY_DSN: { get: async () => "unused" } }).dsn).toBeUndefined();
});

test("env の SENTRY_DSN が文字列 (wrangler secret put の secret) なら、secret を解かない Durable Object の isolate でもその DSN を渡す", () => {
  delete process.env.SENTRY_DSN;

  expect(sentryOptions({ SENTRY_DSN: "https://public@example.com/5" }).dsn).toBe(
    "https://public@example.com/5",
  );
});
