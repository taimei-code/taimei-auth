// cross-subdomain Cookie の有効化判定。判定基準は AUTH_COOKIE_DOMAIN 値そのもの (APP_ENV 非依存)。
// "localhost" を明示設定したケースも disable と解釈する double-guard を含む。
// 詳細: docs/adr/0004-cross-subdomain-cookie-rule.md
export type CrossSubDomainCookies = {
  enabled: boolean;
  domain: string;
};

export const resolveCrossSubDomainCookies = (
  authCookieDomain: string | undefined,
): CrossSubDomainCookies => ({
  enabled: !!authCookieDomain && authCookieDomain !== "localhost",
  domain: authCookieDomain || "taimei-code.com",
});
