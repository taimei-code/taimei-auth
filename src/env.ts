// APP_ENV 派生 boolean のうち、複数箇所で重複していた isLocalEnvironment を集約する。
// useSecureCookies / crossSubDomainCookies / GitHub OAuth 有効化 / Sentry DSN 有無 等の
// 1 箇所消費の env 派生は集約しない (yagni、本ファイルを「env 関連の総合バケット」化させない)。
// 詳細: ~/.claude/plans/taimei/ADR-006-codebase-slim-down.md (D4-2)
export const isLocalEnvironment = (): boolean => process.env.APP_ENV !== "production";
