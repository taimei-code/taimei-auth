# web/src/ 共通画面SPA実装規則

`web/src/` 配下へファイルを追加、移動、変更する時に適用する。

詳細な配置判断は [`ADR-0015`](../../docs/adr/0015-web-domain-first-directory-structure.md) を正本とする。

## 所有domainを決める

ファイルの所有者はURLではなく、変更理由となる業務ドメインで決める。

`/account/*` の画面であっても、company、membership、invitation、mfaの操作は各domainが所有する。

新規または移動するファイルは、所有domain、route entryか否か、公開するcross-domain interface、test配置を説明できた時点で配置完了とする。

## 第1階層の責務

第1階層は `app`、`auth`、`account`、`company`、`membership`、`invitation`、`mfa`、`shared` とする。

- `app`：route、layout、provider、guardの結線。
- `auth`：ログイン、サインアップ、認証client、認証後redirect。
- `account`：プロフィール、アカウント削除、セキュリティ、セッション、連携アカウント、現在activeな事業所のread model。
- `company`：事業所の作成、選択、編集、削除。
- `membership`：member一覧、role変更、除名、OWNER委譲。
- `invitation`：招待の作成、一覧、取消、受諾。
- `mfa`：MFA登録、有効化、無効化、MFAチャレンジ、code入力。
- `shared`：domainを知らないUI primitive、通知、汎用hook、HTTP基盤。

複数domainから利用されることだけを理由に `shared` へ移さない。

## ファイル配置

- route entryだけを `auth/`、`account/`、`company/`、`membership/`、`invitation/`、`mfa/` の `pages/` に置く。
- page以外のdomain固有moduleはdomain直下に置く。
- domainが肥大化した場合は、技術分類ではなく `challenge` や `registration` のような機能名で分割する。
- `lib/`、`components/`、domain barrelの `index.ts` を作らない。
- UI primitiveは `shared/ui/` に置き、domain型またはdomain判断をimportしない。
- testは所有domainの `__tests__/` に置く。

## 依存方向

- domain内部では相対importを使う。
- 他domainの `pages` をimportできるのは `app` だけとする。
- cross-domain importは `src/__tests__/web-domain-structure.test.ts` のfile path allowlistに従う。
- allowlistへのpath追加は、新しいcross-domain interfaceを設ける設計変更としてreviewする。
- `shared` からdomainまたは `app` をimportしない。
- browser-safe検査を通る `@core` moduleだけを利用する。
- domain barrelを経由せず、許可されたfileを直接importする。

## HTTPとerror

- URL、request、response、operation固有のerror変換は所有domainに置く。
- `shared/request-json.ts` はdomain-freeなJSON request処理だけを所有する。
- 同じstatusでも意味が異なるoperationの文言を `shared` に集約しない。
- MFAはbody error codeの区別を必要とするため、MFA API処理を汎用requestへ統合しない。

## 検証

- ファイル追加、移動、import変更では `src/__tests__/web-domain-structure.test.ts` を実行する。
- `@core` import変更では `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。
- browser挙動へ影響する変更ではtypecheck、web build、該当focused testとE2Eを実行する。
- compose環境でbrowser確認する前に `docker compose up --build -d auth-service` でauth-serviceをrebuildする。
