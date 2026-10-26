declare const ttlKeyBrand: unique symbol;

export type TtlKey = string & { readonly [ttlKeyBrand]: "TtlKey" };

export const OWN_KEY_PREFIXES = [
  "rate-limit:magic-link:ip",
  "rate-limit:magic-link:email",
  "rate-limit:canary:ip",
  "rate-limit:mfa-challenge:ip",
  "rate-limit:mfa-challenge-status:ip",
  "rate-limit:mfa-attempt",
  "invitation_rate",
  "mfa:disable-attempts",
  "mfa:login-challenge-attempts",
  "mfa:login-challenge",
  "health",
] as const;

export type OwnKeyPrefix = (typeof OWN_KEY_PREFIXES)[number];

export const ownKey = (prefix: OwnKeyPrefix, subject: string): TtlKey =>
  `${prefix}:${subject}` as TtlKey;

export const HEALTH_PING_KEY = ownKey("health", "ping");

export const SESSION_INDEX_PREFIX = "active-sessions-";
export const VERIFICATION_PREFIX = "verification:";

const SESSION_TOKEN = /^[A-Za-z0-9]{32}$/;

const hasSubjectAfter = (key: string, prefix: string) =>
  key.startsWith(prefix) && key.length > prefix.length;

export const isSessionToken = (value: unknown): value is string =>
  typeof value === "string" && SESSION_TOKEN.test(value);

export const betterAuthKey = (key: string): TtlKey | null =>
  isSessionToken(key) ||
  hasSubjectAfter(key, SESSION_INDEX_PREFIX) ||
  hasSubjectAfter(key, VERIFICATION_PREFIX)
    ? (key as TtlKey)
    : null;

export const isSessionIndexKey = (key: TtlKey): boolean => key.startsWith(SESSION_INDEX_PREFIX);
