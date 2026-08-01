// APP_ENV 派生 boolean のうち、複数箇所で重複していた isLocalEnvironment を集約する。
// useSecureCookies / crossSubDomainCookies / GitHub OAuth 有効化 / Sentry DSN 有無 等の
// 1 箇所消費の env 派生は集約しない (yagni、本ファイルを「env 関連の総合バケット」化させない)。
// 詳細: ~/.claude/plans/taimei/ADR-006-codebase-slim-down.md (D4-2)
export const isLocalEnvironment = (): boolean => process.env.APP_ENV !== "production";

// Bun ランタイムか (Workers/workerd では false)。dual-runtime の「ロード時自動 init」判定と、
// Bun でのみ成立する capability (例: better-auth の DB verification 消費) の判定に使う。
// 詳細: docs/adr/0011-cloudflare-workers-migration.md
export const isBunRuntime = (): boolean => typeof Bun !== "undefined";

// CORS (src/app.ts) と better-auth trustedOrigins (src/auth.ts) の 2 箇所で同一の origin 集合を
// 要求するため集約する。区切りや trim の扱いが片方だけ変わると「CORS は通るが better-auth が弾く」
// 切り分け困難な不整合になる (1 箇所消費なら集約しない方針の例外)。
export const getTrustedOrigins = (): string[] =>
  (process.env.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean);
