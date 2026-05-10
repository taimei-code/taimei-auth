// 検証ポリシー: docs/adr/0003-redirect-url-allowlist-policy.md
export type ServiceName = "taimei" | "accounts";

export interface TaimeiServiceConfig {
  readonly name: string;
  readonly allowedHostPattern: RegExp;
  readonly noindex: boolean;
}

const isLocalEnv = process.env.APP_ENV !== "production";

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
