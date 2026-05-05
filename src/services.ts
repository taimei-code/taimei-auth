// TAIMEI_SERVICES: 共通ログイン経由でログイン可能なプロダクト一覧。
// プロダクト追加時は本マップに 1 entry 追加するだけで完結する設計 (sign 流: URL 構築はプロダクト側に委譲)。
//
// 各エントリは:
//   - name: Layer B のブランディング表示用 + Sentry context tag
//   - allowedHostPattern: redirect_url 検証で使う host pattern (RegExp)
//   - noindex: 検索エンジン除外フラグ (Layer B の <meta> 制御)
//
// allowedHostPattern を厳格に書く理由: 攻撃者が ?redirect_url=https://evil.com を仕込んで
// オープンリダイレクト → 認証情報窃取という典型攻撃を host suffix matching ではなく完全一致で防ぐ。
// freee-accounts の `lib/freee/url_validator.rb` は suffix match だが、taimei-auth は最初から完全一致 regex で実装する。

export type ServiceName = "taimei" | "accounts";

export interface TaimeiServiceConfig {
  readonly name: string;
  readonly allowedHostPattern: RegExp;
  readonly noindex: boolean;
}

// APP_ENV !== "production" (= test / development / 未設定) では .local hostname も許可。
// Vite bundle には vite.config.ts の define で文字列置換される。Hono server 側は
// 通常の process.env 参照。validateRedirectUrl は url.hostname (port 含まない) で
// 比較するため regex も port を含めない。production だけ厳格な .com のみ。
const isLocalEnv = process.env.APP_ENV !== "production";

export const TAIMEI_SERVICES: Record<ServiceName, TaimeiServiceConfig> = {
  taimei: {
    name: "taimei",
    allowedHostPattern: isLocalEnv
      ? /^app\.taimei-code\.(com|local)$/
      : /^app\.taimei-code\.com$/,
    noindex: false,
  },
  accounts: {
    name: "taimei-auth",
    allowedHostPattern: isLocalEnv
      ? /^auth\.taimei-code\.(com|local)$/
      : /^auth\.taimei-code\.com$/,
    noindex: true,
  },
} as const;
