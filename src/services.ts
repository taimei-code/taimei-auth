import { isLocalEnvironment } from "./env";

export const SERVICE_NAMES = ["taimei", "accounts"] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export interface TaimeiServiceConfig {
  readonly name: string;
  readonly allowedHostPattern: RegExp;
  readonly noindex: boolean;
}

const isLocalEnv = isLocalEnvironment();

export const TAIMEI_SERVICES: Record<ServiceName, TaimeiServiceConfig> = {
  taimei: {
    name: "taimei",
    allowedHostPattern: isLocalEnv
      ? /^app\.taimei-code\.(com|local)$|^localhost$/
      : /^app\.taimei-code\.com$/,
    noindex: false,
  },
  accounts: {
    name: "taimei-auth",
    allowedHostPattern: isLocalEnv
      ? /^auth\.taimei-code\.(com|local)$|^localhost$/
      : /^auth\.taimei-code\.com$/,
    noindex: true,
  },
} as const;
