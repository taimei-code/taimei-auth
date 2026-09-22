# ADR-0003: redirect_url は完全一致 host allowlist + 厳格 URL 検証で防御する

## Context

**共通ログイン画面** (`/auth/`) は `?service_name=...&redirect_url=...&sign_up_url=...` を受け取り、認証完了後に `redirect_url` へ 302 する。**sign 流** (CONTEXT.md 参照) ではプロダクト側で URL を組み立てるため、taimei-auth は受信側で allowlist 検証を行う責任を持つ。検証が緩いと典型的なオープンリダイレクトになり、認証情報の窃取に直結する。

freee-accounts の `lib/freee/url_validator.rb` は host の suffix matching だが、taimei-auth は最初から完全一致の regex で実装する。

## Decision

`src/url-allowlist.ts` の `validateRedirectUrl(url, service)` で次を順に検証する。

1. URL として parse できること (失敗したら reject する)
2. protocol が `http:` または `https:` であること (`javascript:` / `data:` / `file:` / `ftp:` などは拒否する)
3. userinfo が無いこと (`url.username === ""` かつ `url.password === ""`)。`https://app.taimei-code.com@evil.com/` のような混同攻撃を明示的に弾く
4. `url.hostname` の末尾ドット (`app.taimei-code.com.`) を除去する
5. その host が `TAIMEI_SERVICES[service].allowedHostPattern` (RegExp) に**完全一致**すること

`allowedHostPattern` は service ごとに env で切り替える。

- `APP_ENV !== "production"`: `.taimei-code.com` / `.taimei-code.local` / `localhost` を完全一致で許可する
- `APP_ENV === "production"`: `.taimei-code.com` のみ完全一致で許可する

`signInParamsSchema` (`src/sign-in-params.ts`) は `redirect_url` と `sign_up_url` に `min(1).max(2048)` の Zod 制約を加える。**共通画面 SPA** で parse に失敗した場合は `/auth/error?reason=invalid_redirect_url` に誘導する。

## Why

- **完全一致 regex**: `endsWith(".taimei-code.com")` のような suffix match は `evil-taimei-code.com` を通してしまう典型的なバグの原因になる。完全一致ならこの攻撃面は無い
- **Punycode の正規化を URL parser に任せる**: JavaScript の `URL` は IDN を Punycode に自動で正規化する。Cyrillic の homograph (а: U+0430) を含む host は `xn--` で始まるため regex に一致せず弾かれる。大文字も小文字に変換される (URL spec)
- **userinfo の明示的な拒否**: parser を通せば hostname は結局 `evil.com` に解決され allowlist で弾かれるが、意図しない解釈経路を予防的に塞ぐため明示的にも拒否する
- **localhost の完全一致**: docker compose の単体起動 (auth-service:3100) で `redirect_url=http://localhost:3100/account` を通すため。完全一致なので `localhost.evil.com` は弾かれる
- **max(2048)**: 主要ブラウザや nginx の既定の URL 長制限は 2048〜8192 byte である。安全側の 2048 を採る

## Consequences

- production で長い URL が必要になったら個別に緩める (現状は不要)
- IDN を意図的に許可したいケース (例: 日本語ドメイン) は出ないため、Punycode の正規化任せで十分である。要求が出たらこの ADR を再検討する
- `service_name` 自体は `signInParamsSchema` の Zod enum で validate するため、`TAIMEI_SERVICES[service]` の lookup は安全である
