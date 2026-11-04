import { onceUntilSucceeded } from "./once-until-succeeded";

export const SECRET_BINDING_NAMES = [
  "AUTH_SECRET",
  "AUTH_SERVICE_KEY",
  "AUTH_RESEND_KEY",
  "MFA_TOTP_ENCRYPTION_KEYS",
  "AUTH_GITHUB_ID",
  "AUTH_GITHUB_SECRET",
  "BLOB_READ_WRITE_TOKEN",
  "SENTRY_DSN",
] as const;

export type SecretBindingName = (typeof SECRET_BINDING_NAMES)[number];

type SecretsStoreSecret = { get: () => Promise<string> };

const isSecretsStoreSecret = (value: unknown): value is SecretsStoreSecret =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { get?: unknown }).get === "function";

export const resolveSecretBindings = async (env: Record<string, unknown>): Promise<void> => {
  for (const name of SECRET_BINDING_NAMES) {
    const binding = env[name];
    if (typeof binding === "string") process.env[name] = binding;
    else if (isSecretsStoreSecret(binding)) process.env[name] = await binding.get();
  }
};

type FetchHandler<E, C> = { fetch: (request: Request, env: E, ctx: C) => Promise<Response> };

export const resolveSecretsBeforeHandler = <E extends Record<string, unknown>, C>(
  handler: FetchHandler<E, C>,
): FetchHandler<E, C> => {
  let resolveSecrets: (() => Promise<void>) | null = null;
  return {
    async fetch(request, env, ctx) {
      resolveSecrets ??= onceUntilSucceeded(() => resolveSecretBindings(env));
      await resolveSecrets();
      return handler.fetch(request, env, ctx);
    },
  };
};
