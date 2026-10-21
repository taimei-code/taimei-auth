# web/src/ 共通画面SPA実装規則

配置の判断は [`ADR-0015`](../../docs/adr/0015-web-domain-first-directory-structure.md) が定義元である。cross-domain import の allowlist は `src/__tests__/web-domain-structure.test.ts` が固定し、path の追加は新しい cross-domain interface を設ける設計変更として review する。

## 所有 domain

ファイルの所有者は、URL ではなく変更理由となる業務ドメインで決める。`/account/*` の画面であっても、company、membership、invitation、mfa の操作は各 domain が所有する。

- `app`: route、layout、provider、guard の結線。他 domain の `pages` を import できる唯一の場所。
- `auth`: ログイン、サインアップ、認証 client、認証後の redirect。
- `account`: プロフィール、削除、セキュリティ、セッション、連携アカウント、現在の事業所の read model。
- `company` / `membership` / `invitation` / `mfa`: 各業務の操作。
- `shared`: domain を知らない UI primitive、通知、汎用 hook、HTTP 基盤。複数の domain から使われることだけを理由に `shared` へ移さない。`shared/ui/` は domain の型と domain の判断を import しない。

## 配置

- route entry だけを各 domain の `pages/` に置き、それ以外の domain 固有 module は domain 直下に置く。肥大化したら `challenge` や `registration` のような機能名で分割する。
- `lib/`、`components/`、domain barrel の `index.ts` を作らず、許可されたファイルを直接 import する。domain の内部は相対 import にする。
- サーバーのデータの取得と更新は、`<domain>/<domain>-atom.ts` に `SpaApiClient` (`shared/spa-api-client.ts`) の `query` と `mutation` で置き、component と hook はその atom を読む。見本は `membership/membership-atom.ts` と、それを読む `membership/MemberList.tsx` (画面は `membership/pages/Members.tsx`)。better-auth の client の一覧 (session・連携アカウント) も `account/account-atom.ts` の atom で読み、client が返す `error` を失敗にする。他の場所から `fetch`・`SpaApiClient`・better-auth の一覧の読み出しを使うと `src/__tests__/web-data-access.test.ts` が落とす。読み取りだけの画面は、読み出しの結果を `shared/AsyncSection.tsx` にそのまま渡す。取り直しの間も古い行を残す一覧は、`membership/MemberList.tsx` のように読み込み中の行と `failedBeforeAnyValue` の文言を自分で書く。
- 更新は `*-atom.ts` が hook (例: `useChangeRole`) として渡し、mutation の atom は export しない (route の loader が `runMutation` で使う atom だけを export する)。一覧や事業所状態を変える更新は、hook が `reactivityKeys` を足し、画面は取り直しの完了を `shared/atom-runtime.ts` の `useWaitForValue` で待つ。初回の取得の失敗は `failedBeforeAnyValue` で判定して文言を出す。取り直しを利用者の操作まで遅らせる時だけ `useRefreshAndWait` を使う (MFA の有効化の後、リカバリーコードを閉じるまで)。
- 画面の失敗の文言は、契約に宣言した失敗の `_tag` から `shared/failure-message.ts` の `failureMessage` で選ぶ。表は宣言した失敗の `_tag` を `Unauthorized` を除いてすべて持つ必要があり、文言は各画面に置く (同じ `_tag` でも画面ごとに意味が違うため)。`Unauthorized` は `shared/spa-api-client.ts` だけが扱い、今の URL を戻り先にして共通ログイン画面 (`/auth/`) へ移すので、表に書かない。文言でなく画面の動きを `_tag` で分ける時は、同じ file の `failureOutcome` で宣言した失敗のすべての `_tag` に結果を割り当てる (server が失敗を足すと表が足りずに型エラーになる)。`onFailure` で cause を捨てない (捨てると `src/__tests__/web-data-access.test.ts` が落ちる)。MFA の画面は同じ失敗に同じ文言を出すので、`mfa/mfa-atom.ts` の 1 つの表を共有する。

## 遷移

- route は `app/router.tsx` に置く。page は route の値を `getRouteApi(<route id>)` の `useSearch` / `useLoaderData` で読む。
- search は route の `validateSearch` で parse し、page で `URLSearchParams` を読まない (biome の `noRestrictedGlobals` が落とす)。検査に失敗した時に既定の値を使う search は、`validateSearch` の中で既定の値にする。
- 遷移を起点とする処理 (画面を開く前の確認、招待の受諾の POST、状態の取得) は route の `beforeLoad` / `loader` に置き、`pages/` で `useEffect` を使わない (`web-data-access.test.ts` が落とす)。判定は domain の関数が `shared/route-entry.ts` の `RouteEntry` を返し、`app/route-redirect.ts` の `redirectFor` だけが `redirect` に写す (例: `company/company-signup-entry.ts`)。
- 遷移は `Link` / `navigate` / `redirect` で書き、path と search を型で検査させる。`/auth` と `/account` をまたぐ遷移と、認証の状態が変わった後の遷移は `reloadDocument` にする (理由は ADR-0002 の router の節)。router の外で SPA を離れる遷移 (`window.location`) は `shared/leave-spa.ts` だけが書き、sign-out は `auth/sign-out.ts` の `signOut` だけが better-auth を呼ぶ (`web-data-access.test.ts` が落とす)。

## 検証

- `@core` import を変えたら `src/__tests__/web-shared-core-runtime-free.test.ts` を実行する。
- compose で browser 確認する前に `docker compose up --build -d auth-service` で rebuild する。
