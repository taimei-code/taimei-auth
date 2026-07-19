# taimei-auth

taimei-auth は taimei エコシステム全体で共有する認証サービス。複数プロダクト (taimei 本体, accounts 等) からの認証要求を一元処理し、自プロセス内に Web UI / IdP / User・Account・Session DB を同居させる。将来的に identity DB レイヤを別プロセスに切り出せる構造を維持する。

## Language

### 事業所 / ドメイン主体

**事業所 (company)**:
taimei における課金単位かつ user の所属先となるドメイン主体。1 つの法人格 or 個人事業主が 1 事業所として登録される。1 user は **membership** を介して複数事業所に所属可能 (N:M)。`org_code` で `PERSONAL` (個人事業主) と `CORPORATE` (法人) を区別する。詳細: ADR-009。
_Avoid_: 組織 / organization (より広義、`tenant_id` と意味重複), 事業者 / merchant (EC 寄りの語感), tenant (proto reserved field とのみ対応する内部 ID 概念)

**membership**:
1 user が 1 **事業所** に所属する関係を表す行。N:M bridge エンティティ。`role` (OWNER/ADMIN/MEMBER) を持ち、行の存在自体が「確定所属」を表す (= INVITED 状態は持たず、未承諾の招待は **invitation** で別管理)。離脱 / 除名は audit_log 1 行記録した上で行 hard delete。技術プリミティブとして DB / proto / TS type で英語 `membership` を一貫使用。詳細: ADR-009 §D4 / Q3。
_Avoid_: メンバーシップ (カタカナ語、UI に冗長), affiliation (より広義), association (DB 関係の意味と衝突), invitation_status (membership 列ではなく invitation テーブルで管理)

**current_company_id** / **last_used_company_id**:
2 つの近接概念を分離して使い分ける (ADR-009 Q9):
- `session.current_company_id` (`Session.company_id` proto field): **現在 active な事業所**。1 session 内で操作対象となる事業所。`/account` の CompanySwitcher で切替可能、`SetCurrentCompany` RPC で UPDATE + Redis cookieCache invalidate。`NULL` = 「事業所未選択」状態 (= membership 0 件 / 唯一 company DELETED 直後)
- `user.last_used_company_id` (`User.default_company_id` proto field): **新規 session 確立時の default 候補**。better-auth lifecycle hook が session 確立時にこの値を `current_company_id` に copy する
_Avoid_: default_company_id (user 列だが proto field のみ。DB 列名は last_used_company_id), active_company_id (current_company_id の同義語、混在禁止)

**activation_status**:
**事業所** のライフサイクル状態を表す列。`ACTIVE` / `DELETED` の 2 値のみ (freee `nest-auth` の `Company_ActivationStatus` から INVITING / DUPLICATED 等を除外した縮退形)。DeleteCompany RPC で `DELETED` + `deleted_at = now()` の soft delete、ACTIVE への復元は admin DB 操作のみ (UI から不可)。物理削除は本 ADR スコープ外 (Phase E+ の GDPR retention ADR の trigger 待ち)。詳細: ADR-009 Q21。
_Avoid_: status (より広義), state (将来 INVITING など別軸の状態と混同), deleted (boolean column への矮小化、deleted_at timestamp と分離)

**org_code**:
**事業所** が `PERSONAL` (個人事業主) か `CORPORATE` (法人) かを表す列。OWNER のみが `UpdateCompany` RPC で変更可能、変更時は `audit_log.event_type='company_updated'` に before/after diff を記録 (ADR-009 Q8 結論)。
_Avoid_: company_type (より広義), business_type (業種と紛らわしい)

**メンバー (member)**:
ある **事業所** の **membership** を占める user を、その事業所の文脈で呼ぶ UI 上の呼称。「メンバーを事業所から削除」= 当該 membership 行 delete (user 本体は残る) を意味する。動詞句で範囲を明示することで「user 本体削除」との誤読を防ぐ。
_Avoid_: ユーザー (より広義、global user を指す時に使う), メンバーシップ (関係の方を指す時は **membership**)

**role**:
**membership** が表現する権限階層。`OWNER` / `ADMIN` / `MEMBER` の 3 段階。OWNER のみが事業所削除 / 課金変更 / OWNER 権限委譲を行える。ADMIN は OWNER を作れず、自身の昇格もできない (= OWNER 昇格は OWNER のみ承認可)。1 事業所に複数 OWNER を許容する。詳細: ADR-009。
_Avoid_: 役職 (人事ドメインの語と紛らわしい), permission (個別アクション認可と混同), member_type (freee の `Membership.Type` は業種分類で role とは別概念)

**invitation**:
**事業所** から外部 email 宛に出された「メンバー参加」の打診 1 件。`token` + `expires_at` (24h) + `used_at` で単発消費を管理する verification 的な独立テーブル。受諾されると **membership** 行が新規作成される (= INVITED 状態の dangling membership 行は作らない)。期限切れ / 取消は invitation 行に対する update + audit 記録で表現。
_Avoid_: 招待状態 (membership に invitation_status 列を持たせるパターン、ADR-009 Q3 で不採用), pending member (status 表現と紛らわしい)

### 認証画面 (共通画面 SPA)

**共通ログイン画面**:
複数プロダクトが共有して使う、認証の起点となる Web UI (`/auth/`)。**共通画面 SPA** が React Router で出すサブ画面のひとつ。
_Avoid_: ログイン画面, SignIn 画面, `/auth/`

**共通サインアップ画面**:
新規ユーザー登録用の対称画面 (`/auth/signup`)。`name` 入力欄が追加されること以外は **共通ログイン画面** と同じ Magic Link / GitHub OAuth 経路を提供する。
_Avoid_: SignUp 画面, 新規登録画面, サインアップ

**アカウント管理画面**:
ログイン後のプロフィール / セキュリティ / セッション / 連携アカウント管理画面 (`/account/*`)。**共通画面 SPA** が React Router で出す 3 つ目のサブ画面群。
_Avoid_: マイページ, account ページ

**auth ホスト**:
`auth.taimei-code.com` の HTTP entry すべてを 1 プロセスで担う Hono server (`src/index.ts`)。better-auth IdP (`/api/auth/*`)、ConnectRPC (`/rpc/*`)、`/login` ショートカット、`/health`、**共通画面 SPA** の配信 (`/auth/*` `/account/*`) を同居させる (CLAUDE.md ルール 1-2 の「Web UI / IdP / DB の同居」のうち HTTP 入口を担う層)。**共通画面 SPA** からの fetch と consumer app からの RPC の両方を受ける。
_Avoid_: Layer A (順序ラベルで内容を示さない), バックエンド, server (より広義), Hono server (実装名で抽象が剥がれる)

**共通画面 SPA**:
`web/` 配下の Vite + React CSR app。**auth ホスト** が `/auth/*` `/account/*` で配信する単一 build で、React Router で **共通ログイン画面** / **共通サインアップ画面** / **アカウント管理画面** の 3 系統に分岐する。詳細: ADR-0002。
_Avoid_: Layer B (順序ラベルで内容を示さない), フロント, クライアント, Web UI (より広義)

**canary token**:
**共通画面 SPA** のログイン / サインアップ画面に 3 経路で埋込まれる識別子 (`VITE_CANARY_TOKEN_ID`)。不可視リンク / hidden input / favicon URL の 3 経路は通常ユーザーが踏まないため、ヒットすればフィッシング DOM scraping や form 自動送信、favicon prefetch 等の自動化試行を Sentry に通報できる。`/auth/canary-token/:token` で受けて 204 No Content を返却 (攻撃者へのフィードバック遮断)。詳細は ADR-0005 参照。
_Avoid_: ハニーポット (より広義), ビーコン

### URL 構築 / 経路

**`/login` ショートカット**:
`auth.taimei-code.com/login` → `/auth/?service_name=accounts&redirect_url=<auth>/account` への内部 302。taimei-auth 自身のアカウント管理画面 (`/account`) に向かうログインフローを 1 経路で起動する。
_Avoid_: ログイン入口, login redirect

**session-aware redirect**:
ログイン経路 (`/`, `/login`) への訪問時、認証済みなら `/account` へ 302、未認証なら通常の認証フロー (`/auth/?...`) に進ませる server-side 挙動。**共通ログイン画面** / **共通サインアップ画面** の直訪問は対象外 (未認証ユーザー多数派の penalty を避けるため)。
_Avoid_: auto redirect, 自動リダイレクト

**sign 流**:
freee の最新 design pattern。プロダクト側で URL (`?service_name=...&redirect_url=...`) を構築し、taimei-auth 側は allowlist 検証のみを行う。中央集権型 (旧 `Sessions::<Service>Controller#path_to_after_login`) と対比される。
_Avoid_: 共通ログイン pattern (両 pattern を含むため曖昧)

### 識別子 / パラメータ

**service_name**:
`TAIMEI_SERVICES` のキー。リクエスト元プロダクトの identity を表す。現状 `taimei` / `accounts` の 2 種。
_Avoid_: product, app

**redirect_url**:
認証完了後にユーザーが遷移するプロダクト側 URL。`signInParamsSchema` の Zod 検証 + `validateRedirectUrl` の host allowlist 検証を通過する必要がある。
_Avoid_: callbackURL (better-auth API 用語), destination, 戻り先

**sign_up_url**:
新規登録完了後の遷移先 URL (通常は onboarding 画面)。**共通サインアップ画面** でのみ意味を持ち、未指定時は `redirect_url` にフォールバックする。
_Avoid_: onboarding URL, after-signup URL (こちらは proxy 側 path を指す別概念)

**TAIMEI_SERVICES**:
`src/services.ts` で定義する、共通ログイン基盤を利用可能なプロダクトのレジストリ。各エントリは `name` (ブランディング表示) + `allowedHostPattern` (RegExp による host 完全一致検証) + `noindex` を持つ。
_Avoid_: services map, product registry

**accounts**:
`service_name=accounts` で指す、taimei-auth 自身のアカウント管理画面 (`/account/*`) を service として扱う識別子。
_Avoid_: account service (混同しやすい), taimei-auth itself

**taimei**:
`service_name=taimei` で指す taimei 本体プロダクト (`app.taimei-code.com`)。
_Avoid_: app

### 認証手段 / セッション

**Magic Link**:
メールアドレス宛に送られるワンタイムリンク。クリックで `/api/auth/magic-link/verify?token=...` にアクセスし、token verify + session 確立 + `callbackURL` への 302 が完結する。better-auth の magicLinkClient 機能。
_Avoid_: メールリンク

**session**:
better-auth が管理する認証状態。Cookie (`.taimei-code.com` ドメイン) で識別、Redis (secondaryStorage) と Postgres (`session` テーブル) に二重保管。`auth.api.getSession({ headers })` で server-side 取得。
_Avoid_: 認証状態 (より広義), Cookie (識別子に過ぎない)

**sign-out**:
ユーザー自身が `auth.api.signOut()` を呼び、current **session** を意図的に terminate する操作。Cookie 削除 + Redis cookieCache invalidate + Postgres `session` 行削除を伴う。
_Avoid_: logout (英語混在を避ける), session 終了 (より広義)

**session revoke**:
better-auth lifecycle hook や admin 操作によって、user 自身の意思とは独立に **session** を強制無効化する操作。`session.revoked_at` 列に時刻を記録し、VerifySession が `RESULT_REVOKED` を返す状態にする。**sign-out** (ユーザー自発) と対比される。trigger は password change / account delete 等の security-sensitive operation。
_Avoid_: invalidate (より広義), terminate, kill

**membership guard**:
**アカウント管理画面** 系の操作 API (**auth ホスト** の `/api/account/*`) の認可入口 (`src/membership/guard/` directory module)。**session** からの actor 解決 (fail-closed: 解決失敗は拒否に倒す) と、**membership** の存在 / **role** 階層 (OWNER > ADMIN > MEMBER) に基づく操作可否判定を一手に担う。target 側 role 規則 (OWNER への操作は OWNER のみ等) の policy 判定も同じ語で指す。認可の入口は 2 系統: generic entry (`requireActor` / `requireMembership` / `requireMembershipOf`) と、operation 単位 entry (`requireRoleChange` / `requireRemoval` / `requireTransferOwnership` / `requireInvite` / `requireInvitationAccept`)。後者は 401→400→403→404 の順で target 側の canChangeRole / canInviteRole / canAttemptRemoval / canRemoveTarget を含めた 1 発回答を返し、handler は `if (!r.ok) return guardErrorResponse(r)` の 1 行で HTTP に写像する。詳細: ADR-0012。
_Avoid_: RBAC (一般語で実体を指さない), authorization (より広義), 認可ミドルウェア (実装形態名)

**audit log**:
user の意図ある action (**sign-in** / **sign-out** / account delete 等) を append-only で記録する DB テーブル (`audit_log`)。**session revoke** などの内部 state change は記録対象外 (それは action の consequence として implicit に類推する)。forensic 用途を想定し、`session` cascade delete で失われる IP / userAgent も payload に persist する。
_Avoid_: event log (より広義), activity log

**audit event**:
**audit log** に記録される 1 行。`event_type` は user action の categorization に限定 (現状 `sign_in` / `sign_out` / `account_delete` / `company_created` / `company_updated` / `company_deleted` / `invitation_sent` / `invitation_accepted` / `invitation_accept_rejected` / `invitation_revoked` / `role_changed` / `membership_removed` / `ownership_transferred` / `company_switched`)。`invitation_accept_rejected` だけは user 意図でなくシステム側の防御発火 (ADR-0012 の OWNER 招待再検証 / unknown role fail-closed / double_accept) の記録で、他の user action event と対称に扱う (発火/非発火の観測性を対称化)。詳細: ADR-0012。Phase 4 で credential change 系が実装された時に event_type を追加する。
_Avoid_: log entry, audit record

## Relationships

- **共通ログイン画面** ↔ **共通サインアップ画面**: 相互リンクで往復可能、`service_name` / `redirect_url` / `sign_up_url` は引き継がれる
- **`/login` ショートカット** → **共通ログイン画面**: 内部 302 で `service_name=accounts&redirect_url=<auth>/account` を組み立てる
- **session-aware redirect**: `/` / `/login` の 2 entry のみに適用 (server-side)。session 有り → `/account` 302、session 無し → 通常フロー
- **TAIMEI_SERVICES** ⊃ **service_name** ∈ {`taimei`, `accounts`}
- **redirect_url** / **sign_up_url**: 必ず `TAIMEI_SERVICES[service_name].allowedHostPattern` の host を満たす必要がある
- 1 つの **session** は複数の **共通ログイン画面** 訪問にまたがって有効 (Cookie で識別)

## Example dialogue

> **Dev**: 「**共通ログイン画面** で Magic Link 送信中に、ユーザーが「新規登録」リンクを押したら?」
> **Domain expert**: 「`magicLinkSent === true` の状態ならリンクは隠す。送信中は完了待ちのフローを優先する」
> **Dev**: 「**`/login` ショートカット** に来た時、既に **session** が valid なら?」
> **Domain expert**: 「**session-aware redirect** で `/account` に直接 302。共通ログイン画面を経由させない」
> **Dev**: 「**共通ログイン画面** に認証済みのまま直訪問したら?」
> **Domain expert**: 「form は出るが何もしない。直訪問は edge case として黙認、`/` `/login` 経由で 95% は救済済み」

## Flagged ambiguities

- 「ログイン画面」は「共通ログイン画面」(**共通画面 SPA** の `/auth/`) と「`/login` ショートカット URL」の両方に解釈される時期があった — resolved: 前者を **共通ログイン画面**、後者を **`/login` ショートカット** に canonical 化
- 初期は「Layer A」「Layer B」と順序ラベルで server / client を区別していたが、内容を示さない抽象表現だったため廃止 — server 側は **auth ホスト**、client 側は **共通画面 SPA** に canonical 化
- 「callbackURL」は better-auth API の引数名としてはそのまま使うが、設計議論では **redirect_url** を使う — better-auth 内部では callbackURL、外部 (URL クエリ) では redirect_url
- 「after-signin」「after-signup」は **proxy 側 path** (e.g. taimei の `/auth/after-signin` Controller) を指す別概念 — taimei-auth 側の **redirect_url** / **sign_up_url** とは指す対象が違うため混同注意
