# ADR-0004: crossSubDomainCookies は AUTH_COOKIE_DOMAIN 値で判定する (APP_ENV 非依存)

## Context

better-auth の session Cookie を `.taimei-code.com` (本番) や `.taimei-code.local` (`/etc/hosts` を設定したローカル開発統合) で subdomain をまたいで共有したい。一方、docker compose の単体起動時は `localhost` で完結させるため、Cookie の domain を設定しない方が安全である (`Set-Cookie: Domain=localhost` を reject するブラウザ実装がある)。

この分岐は `APP_ENV === "development"` などで書きがちだが、`APP_ENV` は環境ラベル (`production` / `development` / `test`) であり、ドメインを共有したいかどうかとは別の概念である。

## Decision

`src/auth.ts` の `crossSubDomainCookies.enabled` は、`AUTH_COOKIE_DOMAIN` env の値そのものを判定基準にする。

```ts
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;
crossSubDomainCookies: {
  enabled: !!authCookieDomain && authCookieDomain !== "localhost",
  domain: authCookieDomain || "taimei-code.com",
},
```

- 未指定または `"localhost"` の場合は無効にする (compose 単体起動との互換性のため)
- それ以外 (`taimei-code.local`、`taimei-code.com`) の場合は有効にする

## Why

`AUTH_COOKIE_DOMAIN` を明示的に設定する行為そのものが、「subdomain をまたいで Cookie を共有したい」という利用者の意思表示である。APP_ENV から推測すると次の問題が起きる。

- `APP_ENV=production` の e2e で `localhost` を使うケースに対応できない
- `APP_ENV=development` で hosts を統合済みの開発者は手動での override が必要になる

env の値そのもので判定すれば、意思と挙動が 1 対 1 で対応する。

## Consequences

- `AUTH_COOKIE_DOMAIN` に `"localhost"` という文字列を明示的に設定した場合も無効と解釈する。誤って `Set-Cookie: Domain=localhost` を出さないための二重の guard である
- `useSecureCookies` は別の軸として `isLocalEnvironment()` (`APP_ENV !== "production"` と同じ) で判定する。Secure 属性は HTTPS の有無に結びつくのが自然で、subdomain を共有する意思とは独立している
