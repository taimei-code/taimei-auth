# ADR-0006: `@taimei-code/auth-client` は IdP の内部表現を一切露出しない

## Context

consumer app (taimei など) が taimei-auth と通信する窓口は `packages/auth-client/` の SDK だけである (CLAUDE.md「共通境界」)。現状の IdP は better-auth だが、将来 Go で自作した IdP などに差し替える可能性を残したい。SDK の interface に IdP の内部詳細が漏れると、IdP の移行時に consumer 側のコードまで連鎖して修正することになる。

consumer 側の上位 ADR (`plans/taimei/ADR-004-idp-encapsulation.md`) で SDK 層の責務が定められており、この ADR は taimei-auth リポジトリの視点でその実装方針を記述する。

## Decision

### Cookie 名は SDK 内に閉じる

`packages/auth-client/src/cookie.ts` で `SESSION_COOKIE_NAMES` (`better-auth.session_token` / `__Secure-better-auth.session_token`) を const として定義し、**SDK の外部には export しない**。consumer は `getSessionTokenFromCookieStore` / `hasAuthCookie` / `extractSessionTokenFromCookieHeader` の helper 関数を通してだけ session token に触れる。

`cookie` パッケージなどの外部依存は持たず、手書きで parse する。SDK は peerDependencies を最小にする方針で (現状は ConnectRPC 関連のみ)、Cookie ヘッダの parse は RFC 6265 が単純で 30 行未満で書けるため、依存を追加するコストの方が自前実装のコストより大きい。

### `SessionData.session` に `token` / `userId` を増やしてはならない

`packages/auth-client/src/guard.ts` の `SessionData` 型は `user: { id, name, email, ... }` と `session: { id, expiresAt }` だけを持つ。`session.token` と `session.userId` は追加しない。

- `token` は IdP の内部表現である (better-auth では opaque ID だが、Go の自作 IdP では JWT などになりうる)。consumer 側に露出させると、IdP 移行時の format の差が SDK の外に漏れる
- `userId` は `user.id` で代替できる。token は Cookie 経由で IdP に再提示するだけなので、consumer 側で読む必要がない

## Why

SDK の interface は consumer のロックイン面である。ここに漏れた構造はバージョンアップでしか剥がせなくなるため、最初から狭く作る。better-auth の opaque session ID と Go 自作 IdP の JWT で format が違っても、SDK の interface (`SessionData`) は変わらない構造を維持する。

## Consequences

- consumer 側で「session token を直接見たい」という要求が出たら、helper 関数の追加で対応する (生の cookie 値を返す関数を増やすのはよいが、`SessionData` の構造は拡張しない)
- `cookie.ts` のテストでは、公開 API だけで全シナリオを通すことで、`SESSION_COOKIE_NAMES` が export されていないことを間接的に確認する
- IdP を差し替える時に触るのは `packages/auth-client/src/cookie.ts` と **auth ホスト** の better-auth の接続部 (`src/auth.ts`) だけである。consumer のコードは変更しなくてよい
