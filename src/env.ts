// APP_ENV 派生 boolean のうち複数箇所で重複するものだけを集約する。1 箇所消費の env 派生は集約しない
// (yagni、本ファイルを「env 関連の総合バケット」化させない)。詳細: PR #34 → #35
export const isLocalEnvironment = (): boolean => process.env.APP_ENV !== "production";

// Bun ランタイムか (workerd では false)。dual-runtime の「ロード時自動 init」判定と、Bun でのみ成立する
// capability (better-auth の DB verification 消費等) の判定に使う。詳細: ADR-0011
export const isBunRuntime = (): boolean => typeof Bun !== "undefined";

// CORS (app.ts) と better-auth trustedOrigins (auth.ts) が同一の origin 集合を要求するため集約する。
// 片方だけ trim の扱いが変わると「CORS は通るが better-auth が弾く」切り分け困難な不整合になる。
export const getTrustedOrigins = (): string[] =>
  (process.env.AUTH_TRUSTED_ORIGINS || "").split(",").filter(Boolean);
