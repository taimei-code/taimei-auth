# ADR-0003: redirect_url は完全一致 host allowlist + 厳格 URL 検証で防御する

## Context

**共通ログイン画面** (`/auth/`) は `?service_name=...&redirect_url=...&sign_up_url=...` を受け、認証完了後に `redirect_url` へ 302 する。**sign 流** (CONTEXT.md 参照) ではプロダクト側で URL を組み立てるため、taimei-auth は受信側で allowlist 検証する責任を持つ。緩い検証は典型的なオープンリダイレクト → 認証情報窃取に直結する。

freee-accounts の `lib/freee/url_validator.rb` は host suffix matching だが、taimei-auth は最初から完全一致 regex で実装する。

## Decision

`src/url-allowlist.ts` の `validateRedirectUrl(url, service)` で次を順に検証する:

1. URL parse できること (失敗で reject)
2. protocol が `http:` / `https:` のいずれか (`javascript:` / `data:` / `file:` / `ftp:` 等を拒否)
3. userinfo が無いこと (`url.username === ""` && `url.password === ""`)。`https://app.taimei-code.com@evil.com/` の混同攻撃を明示的に弾く
4. `url.hostname` の末尾ドット (`app.taimei-code.com.`) を除去
5. その host が `TAIMEI_SERVICES[service].allowedHostPattern` (RegExp) に**完全一致**すること

`allowedHostPattern` は service ごとに env で出し分け:

- `APP_ENV !== "production"`: `.taimei-code.com` / `.taimei-code.local` / `localhost` を完全一致で許可
- `APP_ENV === "production"`: `.taimei-code.com` のみ完全一致で許可

`signInParamsSchema` (`src/sign-in-params.ts`) は `redirect_url` / `sign_up_url` に `min(1).max(2048)` の Zod 制約を加え、**共通画面 SPA** で parse 失敗時は `/auth/error?reason=invalid_redirect_url` に誘導する。

## Why

- **完全一致 regex**: `endsWith(".taimei-code.com")` 系の suffix match は `evil-taimei-code.com` を許してしまう典型バグの温床。完全一致なら攻撃面がゼロ
- **Punycode 正規化を URL parser に任せる**: JavaScript の `URL` は IDN を Punycode に自動正規化する。Cyrillic homograph (а: U+0430) を含む host は `xn--` で始まり regex 不一致で弾かれる。大文字も小文字化される (URL spec)
- **userinfo の明示拒否**: parser 経由では結局 hostname は `evil.com` に解決されて allowlist で弾かれるが、明示拒否で意図しない解釈経路を予防的に塞ぐ
- **localhost 完全一致**: docker compose 単体起動 (auth-service:3100) で `redirect_url=http://localhost:3100/account` を通すため。完全一致なので `localhost.evil.com` は弾かれる
- **max(2048)**: 主要ブラウザ / nginx default の URL 長制限が 2048-8192 byte。safe side として 2048

## Consequences

- production で長尺 URL が必要になったら個別に緩める (現状不要)
- IDN を意図的に許可したい (例: 日本語ドメイン) ケースは出ないので Punycode 正規化任せで十分。要求が出たら本 ADR を再検討
- `service_name` 自体は `signInParamsSchema` の Zod enum で validate するため `TAIMEI_SERVICES[service]` の lookup は安全
