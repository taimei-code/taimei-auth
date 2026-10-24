import { REDIRECT_HOST_PATTERNS } from "@taimei-auth/redirect-hosts";

export const SERVICE_NAMES = ["taimei", "accounts"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface TaimeiServiceConfig {
  readonly name: string;
  readonly allowedHostPattern: RegExp;
  readonly noindex: boolean;
}

export const TAIMEI_SERVICES: Record<ServiceName, TaimeiServiceConfig> = {
  taimei: {
    name: "taimei",
    allowedHostPattern: REDIRECT_HOST_PATTERNS.taimei,
    noindex: false,
  },
  accounts: {
    name: "taimei-auth",
    allowedHostPattern: REDIRECT_HOST_PATTERNS.accounts,
    noindex: true,
  },
} as const;
