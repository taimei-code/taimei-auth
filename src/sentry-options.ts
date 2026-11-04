import { SENTRY_REQUEST_PRIVACY } from "./sentry";

export type SentryEnv = { APP_ENV?: string; [key: string]: unknown };

export const sentryOptions = (env: SentryEnv) => ({
  ...SENTRY_REQUEST_PRIVACY,
  dsn: typeof env.SENTRY_DSN === "string" ? env.SENTRY_DSN : process.env.SENTRY_DSN,
  environment: env.APP_ENV ?? "production",
  tracesSampleRate: 0.1,
});
