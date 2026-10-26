export const getTrustedOrigins = (): string[] =>
  (process.env.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean);
