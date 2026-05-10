import * as Sentry from "@sentry/bun";

let initialized = false;

export const initSentry = (): void => {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not set, Sentry will not be initialized");
    return;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
  initialized = true;
};

export { Sentry };
