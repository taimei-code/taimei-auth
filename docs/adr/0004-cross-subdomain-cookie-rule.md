# ADR-0004: crossSubDomainCookies は AUTH_COOKIE_DOMAIN 値で判定する (APP_ENV 非依存)

## Context

better-auth の session Cookie を `.taimei-code.com` (本番) や `.taimei-code.local` (`/etc/hosts` を切ったローカル開発統合) で subdomain 跨ぎで共有したい。一方 docker compose 単体起動時は `localhost` で完結させるため Cookie domain を立てない方が安全 (`Set-Cookie: Domain=localhost` を reject するブラウザ実装がある)。

歴史的にこの分岐を `APP_ENV === "development"` 等で書きがちだが、`APP_ENV` は環境ラベル (`production` / `development` / `test`) であってドメイン共有の意思とは独立した概念。

## Decision

`src/auth.ts` の `crossSubDomainCookies.enabled` は `AUTH_COOKIE_DOMAIN` env の値そのものを判定基準にする:

```ts
const authCookieDomain = process.env.AUTH_COOKIE_DOMAIN;
crossSubDomainCookies: {
  enabled: !!authCookieDomain && authCookieDomain !== "localhost",
  domain: authCookieDomain || "taimei-code.com",
},
```

- 未指定 / `"localhost"` → disable (compose 単体起動の互換性)
- それ以外 (`taimei-code.local`, `taimei-code.com`) → enable

## Why

`AUTH_COOKIE_DOMAIN` を明示設定する行為自体が「subdomain 跨ぎで Cookie を共有したい」というユーザー意思の表明である。APP_ENV から推測すると次の事故が起きる:

- `APP_ENV=production` の e2e で `localhost` を使うケースに対応できない
- `APP_ENV=development` で hosts 統合済の開発者は手動 override が必要になる

env 値そのもので判定すれば意思と挙動が 1:1 で対応する。

## Consequences

- `AUTH_COOKIE_DOMAIN` を `"localhost"` という文字列で明示設定するケースは disable と解釈する。誤って `Set-Cookie: Domain=localhost` を出さないための double-guard
- `useSecureCookies` は別軸で `isLocalEnvironment()` (= `APP_ENV !== "production"`) で判定する。Secure 属性は HTTPS の有無に紐づくのが自然で、subdomain 共有意思とは独立
