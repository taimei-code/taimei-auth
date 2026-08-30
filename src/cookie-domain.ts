export type CrossSubDomainCookies = {
  enabled: boolean;
  domain: string;
};

// 判定基準は AUTH_COOKIE_DOMAIN 値そのもの (APP_ENV 非依存)。"localhost" の明示設定も disable と
// 解釈する double-guard を含む。詳細: ADR-0004
export const resolveCrossSubDomainCookies = (
  authCookieDomain: string | undefined,
): CrossSubDomainCookies => ({
  enabled: !!authCookieDomain && authCookieDomain !== "localhost",
  domain: authCookieDomain || "taimei-code.com",
});
