export const SECRET_BINDING_NAMES = [
  "AUTH_SECRET",
  "AUTH_SERVICE_KEY",
  "AUTH_RESEND_KEY",
  "MFA_TOTP_ENCRYPTION_KEYS",
] as const;

type SecretsStoreSecret = { get: () => Promise<string> };

const isSecretsStoreSecret = (value: unknown): value is SecretsStoreSecret =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { get?: unknown }).get === "function";

export const resolveSecretBindings = async (env: Record<string, unknown>): Promise<void> => {
  for (const name of SECRET_BINDING_NAMES) {
    const binding = env[name];
    if (isSecretsStoreSecret(binding)) process.env[name] = await binding.get();
  }
};
