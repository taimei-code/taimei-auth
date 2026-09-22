# web/src/ 共通画面SPA実装規則

配置の判断は [`ADR-0015`](../../docs/adr/0015-web-domain-first-directory-structure.md) が定義元である。cross-domain import の allowlist は `src/__tests__/web-domain-structure.test.ts` が固定し、path の追加は新しい cross-domain interface を設ける設計変更として review する。

## 所有 domain

ファイルの所有者は、URL ではなく変更理由となる業務ドメインで決める。`/account/*` の画面であっても、company、membership、invitation、mfa の操作は各 domain が所有する。

- `app`: route、layout、provider、guard の結線。他 domain の `pages` を import できる唯一の場所。
- `auth`: ログイン、サインアップ、認証 client、認証後の redirect。
- `account`: プロフィール、削除、セキュリティ、セッション、連携アカウント、現在 active な事業所の read model。
- `company` / `membership` / `invitation` / `mfa`: 各業務の操作。
- `shared`: domain を知らない UI primitive、通知、汎用 hook、HTTP 基盤。複数の domain から使われることだけを理由に `shared` へ移さない。`shared/ui/` は domain の型と domain の判断を import しない。

## 配置

- route entry だけを各 domain の `pages/` に置き、それ以外の domain 固有 module は domain 直下に置く。肥大化したら `challenge` や `registration` のような機能名で分割する。
- `lib/`、`components/`、domain barrel の `index.ts` を作らず、許可されたファイルを直接 import する。domain の内部は相対 import にする。
- URL、request、response、operation に固有の error 変換は所有 domain に置く。`shared/request-json.ts` は domain に依存しない JSON request 処理だけを持ち、同じ status でも意味が異なる文言を `shared` に集約しない。MFA は body の error code を区別する必要があるため、汎用 request へ統合しない。

## 検証

- `@core` import を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。
- compose で browser 確認する前に `docker compose up --build -d auth-service` で rebuild する。
