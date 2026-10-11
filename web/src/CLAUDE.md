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
- サーバーのデータの取得と更新は、`<domain>/<domain>-atom.ts` に `SpaApiClient` (`shared/spa-api-client.ts`) の `query` と `mutation` で置き、component と hook はその atom を読む。見本は `membership/membership-atom.ts` と、それを読む `membership/MemberList.tsx` (画面は `membership/pages/Members.tsx`)。他の場所から `fetch` や `SpaApiClient` を使うと `src/__tests__/web-data-access.test.ts` が落とす。例外は better-auth の client のデータと MFA チャレンジ (`mfa/use-mfa-challenge-flow.ts`) で、理由は ADR-0017 の「web への拡大」節にある。
- 一覧を変える更新は、`*-atom.ts` が一覧の `reactivityKeys` を足した hook (例: `useChangeRole`) として渡し、画面は取り直しの完了を `shared/atom-runtime.ts` の `useWaitForValue` で待つ。事業所状態は `useCurrentCompany()` の `refresh()` で取り直す。初回の取得の失敗は `failedBeforeAnyValue` で判定して文言を出す。
- 画面の失敗の文言は、契約に宣言した失敗の `_tag` から `shared/failure-message.ts` の `failureMessage` で選ぶ。表は宣言した失敗の `_tag` をすべて持つ必要があり、文言は各画面に置く (同じ `_tag` でも画面ごとに意味が違うため)。特定の `_tag` かどうかで分岐する時は、同じ file の `hasFailureTag` を使う。MFA は `mfa/mfa-atom.ts` の `mfaErrorCodeOfCause` で失敗の code に読み替える。

## 検証

- `@core` import を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。
- compose で browser 確認する前に `docker compose up --build -d auth-service` で rebuild する。
