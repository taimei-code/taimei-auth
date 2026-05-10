# ADR-0006: `@taimei-code/auth-client` は IdP の内部表現を一切露出しない

## Context

consumer app (taimei 等) から taimei-auth に話す窓口は `packages/auth-client/` の SDK のみ (CLAUDE.md ルール 3)。現状 IdP は better-auth だが、将来的に Go 自作 IdP 等への差し替え可能性を確保したい。SDK の interface に IdP 内部詳細を漏らすと、IdP 移行時に consumer 側コードまで連鎖修正が要る。

consumer 側の上位 ADR (`plans/taimei/ADR-004-idp-encapsulation.md`) で SDK レイヤーの責務が定められており、本 ADR は taimei-auth リポ視点でのその実装方針を記述する。

## Decision

### Cookie 名前は SDK 内に閉じる

`packages/auth-client/src/cookie.ts` で `SESSION_COOKIE_NAMES` (`better-auth.session_token` / `__Secure-better-auth.session_token`) を const 定義し、**SDK 外部に export しない**。consumer は `getSessionTokenFromCookieStore` / `hasAuthCookie` / `extractSessionTokenFromCookieHeader` の helper 関数経由でのみ session token に触れる。

`cookie` パッケージ等の外部依存は持たず手書き parse する: SDK は peerDependencies を最小化する方針 (現状 ConnectRPC 関連のみ)。Cookie ヘッダ parse は RFC 6265 が単純で 30 行未満で書けるため依存追加コスト > 自実装コスト。

### `SessionData.session` に `token` / `userId` を増やしてはならない

`packages/auth-client/src/guard.ts` の `SessionData` 型は `user: { id, name, email, ... }` と `session: { id, expiresAt }` のみ。`session.token` `session.userId` を追加してはいけない:

- `token` は IdP 内部表現 (better-auth は opaque ID, Go 自作 IdP では JWT 等になりうる)。consumer 側に露出させると IdP 移行時の format 差分が SDK 外に漏れる
- `userId` は `user.id` で代替可能。token は Cookie 経由で IdP に再提示するだけなので consumer 側で読む必要がない

## Why

SDK の interface = consumer のロックイン面。ここに漏らした構造はバージョンアップでしか剥がせなくなるため、最初から狭く作る。better-auth の opaque session ID と Go 自作 IdP の JWT で format が違っても、SDK の interface (`SessionData`) は変わらない構造を維持する。

## Consequences

- consumer 側で「session token を直接見たい」要求が出たら、helper 関数追加で対応する (生の cookie 値を返す関数を増やすのは OK だが、`SessionData` の構造拡張はしない)
- `cookie.ts` のテストで `SESSION_COOKIE_NAMES` の不 export を間接的にチェックする (公開 API だけで全シナリオを通す)
- IdP 差し替え時に touch するのは `packages/auth-client/src/cookie.ts` と **auth ホスト** の better-auth 結線 (`src/auth.ts`) のみ。consumer コードは変更不要
