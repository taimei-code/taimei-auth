export const ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ORG_CODES = ["PERSONAL", "CORPORATE"] as const;
export type OrgCode = (typeof ORG_CODES)[number];

export const PASSKEY_TRANSPORTS = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
] as const;
export type PasskeyTransport = (typeof PASSKEY_TRANSPORTS)[number];

const PASSKEY_CREDENTIAL_ID_MAX_BYTES = 1023;
export const PASSKEY_CREDENTIAL_ID_MAX_BASE64URL_LENGTH = Math.ceil(
  (PASSKEY_CREDENTIAL_ID_MAX_BYTES * 4) / 3,
);
