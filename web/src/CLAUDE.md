# web/src/ 共通画面SPA実装規則

配置判断の正本は [`ADR-0015`](../../docs/adr/0015-web-domain-first-directory-structure.md)。cross-domain import の allowlist は `src/__tests__/web-domain-structure.test.ts` が固定し、path 追加は新しい cross-domain interface を設ける設計変更として review する。

## 所有 domain

ファイルの所有者は URL ではなく変更理由となる業務ドメインで決める。`/account/*` の画面でも company、membership、invitation、mfa の操作は各 domain が所有する。

- `app`: route、layout、provider、guard の結線。他 domain の `pages` を import できる唯一の場所。
- `auth`: ログイン、サインアップ、認証 client、認証後 redirect。
- `account`: プロフィール、削除、セキュリティ、セッション、連携アカウント、現在 active な事業所の read model。
- `company` / `membership` / `invitation` / `mfa`: 各業務の操作。
- `shared`: domain を知らない UI primitive、通知、汎用 hook、HTTP 基盤。複数 domain から使われることだけを理由に `shared` へ移さない。`shared/ui/` は domain 型と domain 判断を import しない。

## 配置

- route entry だけを各 domain の `pages/` に置き、それ以外の domain 固有 module は domain 直下に置く。肥大化したら `challenge` や `registration` のような機能名で分割する。
- `lib/`、`components/`、domain barrel の `index.ts` を作らず、許可された file を直接 import する。domain 内部は相対 import。
- URL、request、response、operation 固有の error 変換は所有 domain に置く。`shared/request-json.ts` は domain-free な JSON request 処理だけを持ち、同じ status でも意味が異なる文言を `shared` に集約しない。MFA は body error code の区別が要るため汎用 request へ統合しない。

## 検証

- `@core` import を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。
- compose で browser 確認する前に `docker compose up --build -d auth-service` で rebuild する。
