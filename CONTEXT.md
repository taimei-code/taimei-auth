# taimei-auth

taimei-auth は、taimei エコシステム全体で共有する認証サービスである。複数のプロダクト (taimei 本体、accounts など) からの認証要求を一箇所で処理し、Web UI、IdP、User・Account・Session の DB を 1 つのプロセスに同居させる。将来 identity DB の層を別プロセスに切り出せる構造を保つ。

## Language

### 事業所 / ドメイン主体

**事業所 (company)**:
taimei における課金単位であり、user の所属先でもあるドメイン主体。1 つの法人格または個人事業主が 1 事業所として登録される。1 user は **membership** を介して複数の事業所に所属できる (N:M)。`org_code` で `PERSONAL` (個人事業主) と `CORPORATE` (法人) を区別する。詳細: PR #55 → #63。
_Avoid_: 組織 / organization (より広義で、`tenant_id` と意味が重なる), 事業者 / merchant (EC 寄りの語感), tenant (proto の reserved field とだけ対応する内部 ID の概念)

**membership**:
1 user が 1 **事業所** に所属する関係を表す行で、N:M の bridge エンティティである。`role` (OWNER/ADMIN/MEMBER) を持ち、行が存在すること自体が「確定した所属」を表す。つまり INVITED 状態は持たず、未承諾の招待は **invitation** で別に管理する。離脱と除名は audit_log に 1 行記録した上で行を hard delete する。技術プリミティブとしては DB、proto、TS type のいずれでも英語の `membership` を一貫して使う。詳細: PR #55 → #63。
_Avoid_: メンバーシップ (カタカナ語で、UI では冗長), affiliation (より広義), association (DB の関係の意味と衝突する), invitation_status (membership の列ではなく invitation テーブルで管理する)

**current_company_id** / **last_used_company_id**:
近接する 2 つの概念を分けて使う (詳細: PR #55 → #63)。
- `user.last_used_company_id` (`User.default_company_id` proto field): **現在の事業所**。auth-client の guard はこの値を consumer に `companyId` として渡す。membership の増減に合わせて `src/membership/apply-change.ts` が書き換える。加入すると加入先になり、この値が指す事業所の所属を失うと残る ACTIVE な所属のどれかになり、所属が 0 件になると `NULL` になる。`/account` の CompanySwitcher (`POST /api/account/current-company`) で切り替えられる。consumer への約束は proto の `User.default_company_id` のコメントを正本とする。
- `session.current_company_id` (`Session.company_id` proto field): 書き込む処理が無い列。値は常に `NULL` なので、guard は `user.last_used_company_id` を使う。
_Avoid_: default_company_id (user の列だが proto field にしか無い。DB の列名は last_used_company_id), active_company_id (current_company_id の同義語で、混在させない)

**activation_status**:
**事業所** のライフサイクル状態を表す列。値は `ACTIVE` と `DELETED` の 2 つだけで、freee `nest-auth` の `Company_ActivationStatus` から INVITING や DUPLICATED などを除いた縮退形である。DeleteCompany RPC は `DELETED` と `deleted_at = now()` を書く soft delete を行い、ACTIVE への復元は admin の DB 操作でしかできない (UI からは不可)。物理削除 (GDPR の hard delete) は未実装で、retention 方針が決まるまで保留している。詳細: ADR-0010 / PR #55 → #63。
_Avoid_: status (より広義), state (将来 INVITING など別の軸の状態と混同する), deleted (boolean 列への矮小化。deleted_at の timestamp とは分ける)

**org_code**:
**事業所** が `PERSONAL` (個人事業主) と `CORPORATE` (法人) のどちらかを表す列。OWNER だけが `UpdateCompany` RPC で変更でき、変更時は `audit_log.event_type='company_updated'` に変更前後の diff を記録する (詳細: PR #55 → #63)。
_Avoid_: company_type (より広義), business_type (業種と紛らわしい)

**メンバー (member)**:
ある **事業所** の **membership** を持つ user を、その事業所の文脈で呼ぶ UI 上の呼称。「メンバーを事業所から削除」は、その membership 行を delete することを意味し、user 本体は残る。動詞句で範囲を明示することで「user 本体の削除」との誤読を防ぐ。
_Avoid_: ユーザー (より広義で、global な user を指す時に使う), メンバーシップ (関係の方を指す時は **membership**)

**role**:
**membership** が表す権限の階層。`OWNER` / `ADMIN` / `MEMBER` の 3 段階がある。事業所の削除、課金の変更、OWNER 権限の委譲は OWNER だけが行える。ADMIN は OWNER を作れず、自分を昇格させることもできない (OWNER への昇格を承認できるのは OWNER だけである)。1 事業所に複数の OWNER を置けるが、OWNER は常に 1 人以上いなければならない。最後の OWNER を減らす操作 (降格、除名、退会) は `last_owner` として拒否される。**membership** と **invitation** の role は常にこの 3 値のいずれかで、それ以外の値は保存されない (未知の role という状態は存在しない)。詳細: PR #55 → #63 / ADR-0010 / ADR-0018。
_Avoid_: 役職 (人事ドメインの語と紛らわしい), permission (個別アクションの認可と混同する), member_type (freee の `Membership.Type` は業種分類で、role とは別の概念)

**invitation**:
**事業所** から外部の email 宛に出す「メンバー参加」の打診 1 件。`token` と `expires_at` (24h) を持つ verification に似た独立テーブルで、状態は `status` (PENDING / ACCEPTED / REVOKED) を正とし、`used_at` は派生値である。受諾されると **membership** 行を新規作成する (INVITED 状態の宙に浮いた membership 行は作らない)。期限切れと取消は、invitation 行の update と audit 記録で表す。
_Avoid_: 招待状態 (membership に invitation_status 列を持たせるパターン。PR #55 → #63 で不採用), pending member (status の表現と紛らわしい)

### 認証画面 (共通画面 SPA)

**共通ログイン画面**:
複数のプロダクトが共有して使う、認証の起点となる Web UI (`/auth/`)。**共通画面 SPA** が React Router で出すサブ画面の 1 つである。
_Avoid_: ログイン画面, SignIn 画面, `/auth/`

**共通サインアップ画面**:
新規ユーザー登録用の、ログイン画面と対になる画面 (`/auth/signup`)。`name` の入力欄が加わること以外は、**共通ログイン画面** と同じ Magic Link / GitHub OAuth の経路を提供する。
_Avoid_: SignUp 画面, 新規登録画面, サインアップ

**アカウント管理画面**:
ログイン後のプロフィール、セキュリティ、セッション、連携アカウントを管理する画面 (`/account/*`)。**共通画面 SPA** が React Router で出す 3 つ目のサブ画面群である。
_Avoid_: マイページ, account ページ

**auth ホスト**:
`auth.taimei-code.com` の HTTP entry をすべて 1 プロセスで受け持つ Hono server (`src/index.ts`)。better-auth IdP (`/api/auth/*`)、ConnectRPC (`/rpc/*`)、`/login` ショートカット、`/health`、**共通画面 SPA** の配信 (`/auth/*` `/account/*`) を同居させる (冒頭で述べた Web UI、IdP、DB の同居のうち、HTTP の入口を受け持つ層)。**共通画面 SPA** からの fetch と consumer app からの RPC の両方を受ける。
_Avoid_: Layer A (順序ラベルで内容を示さない), バックエンド, server (より広義), Hono server (実装名なので抽象を表せない)

**共通画面 SPA**:
`web/` 配下の Vite + React による CSR app。**auth ホスト** が `/auth/*` `/account/*` で配信する単一の build で、React Router で **共通ログイン画面** / **共通サインアップ画面** / **アカウント管理画面** の 3 系統に分岐する。詳細: ADR-0002。
_Avoid_: Layer B (順序ラベルで内容を示さない), フロント, クライアント, Web UI (より広義)

**canary token**:
**共通画面 SPA** のログイン画面とサインアップ画面に 3 経路で埋め込む識別子 (`VITE_CANARY_TOKEN_ID`)。不可視リンク、hidden input、favicon URL の 3 経路は通常のユーザーがアクセスしないため、ヒットすればフィッシングの DOM scraping、form の自動送信、favicon の prefetch などの自動化された試行を Sentry に通報できる。`/auth/canary-token/:token` で受けて 204 No Content を返す (攻撃者へのフィードバックを断つため)。詳細は ADR-0005 参照。
_Avoid_: ハニーポット (より広義), ビーコン

### URL 構築 / 経路

**`/login` ショートカット**:
`auth.taimei-code.com/login` から `/auth/?service_name=accounts&redirect_url=<auth>/account` への内部 302。taimei-auth 自身のアカウント管理画面 (`/account`) に向かうログインフローを 1 つの経路で起動する。
_Avoid_: ログイン入口, login redirect

**session-aware redirect**:
ログイン経路 (`/`, `/login`) への訪問時に、認証済みなら `/account` へ 302 し、未認証なら通常の認証フロー (`/auth/?...`) に進ませる server-side の挙動。**共通ログイン画面** / **共通サインアップ画面** への直接訪問は対象外である (多数派である未認証ユーザーに負担をかけないため)。
_Avoid_: auto redirect, 自動リダイレクト

**sign 流**:
freee の最新の design pattern。プロダクト側で URL (`?service_name=...&redirect_url=...`) を構築し、taimei-auth 側は allowlist の検証だけを行う。中央集権型 (旧 `Sessions::<Service>Controller#path_to_after_login`) と対比される。
_Avoid_: 共通ログイン pattern (両方の pattern を含むため曖昧)

### 識別子 / パラメータ

**service_name**:
`TAIMEI_SERVICES` のキー。リクエスト元のプロダクトの identity を表す。現状は `taimei` と `accounts` の 2 種類。
_Avoid_: product, app

**redirect_url**:
認証完了後にユーザーが遷移するプロダクト側の URL。`signInParamsSchema` の Zod 検証と、`validateRedirectUrl` の host allowlist 検証の両方を通過する必要がある。
_Avoid_: callbackURL (better-auth API の用語), destination, 戻り先

**sign_up_url**:
新規登録完了後の遷移先 URL (通常は onboarding 画面)。**共通サインアップ画面** でだけ意味を持ち、未指定なら `redirect_url` にフォールバックする。
_Avoid_: onboarding URL, after-signup URL (こちらは proxy 側の path を指す別の概念)

**TAIMEI_SERVICES**:
`src/services.ts` で定義する、共通ログイン基盤を利用できるプロダクトのレジストリ。各エントリは `name` (ブランディング表示)、`allowedHostPattern` (RegExp による host の完全一致検証)、`noindex` を持つ。
_Avoid_: services map, product registry

**accounts**:
`service_name=accounts` で指す識別子。taimei-auth 自身のアカウント管理画面 (`/account/*`) を 1 つの service として扱う。
_Avoid_: account service (混同しやすい), taimei-auth itself

**taimei**:
`service_name=taimei` で指す、taimei 本体のプロダクト (`app.taimei-code.com`)。
_Avoid_: app

### 認証手段 / セッション

**Magic Link**:
メールアドレス宛に送るワンタイムリンク。クリックすると `/api/auth/magic-link/verify?token=...` にアクセスし、token の verify、session の確立、`callbackURL` への 302 までが完結する。better-auth の magicLinkClient 機能。
_Avoid_: メールリンク

**多要素認証 (MFA)**:
知識、所持、生体のうち 2 つ以上の要素で本人であることを確認する仕組み。taimei-auth では認証アプリ (**TOTP**) を第二要素として提供し、一次認証 (**Magic Link** / GitHub OAuth) の成功後に **MFA チャレンジ** を要求する。user 単位の任意設定であり、**事業所** による強制は持たない。有効化と無効化のどちらも本人へ通知メールを送る。詳細: ADR-0016。
_Avoid_: 2FA / 二要素認証 (要素数を 2 に固定する語。第二要素が増えた時に成り立たなくなる), twoFactor (better-auth のプラグイン名・テーブル名・API 用語)

**TOTP**:
認証アプリが共有 secret と現在時刻から 30 秒ごとに生成する 6 桁のワンタイムコード (RFC 6238)。taimei-auth が提供する唯一の第二要素で、登録は QR コード (`otpauth://` URI) の読み取りまたは secret の手入力で行う。secret は専用の鍵 ring `MFA_TOTP_ENCRYPTION_KEYS` (key_version 付き AES-256-GCM) で暗号化して保管し、鍵のローテーションは version を追記する手順で行える。詳細: ADR-0016。
_Avoid_: OTP / ワンタイムパスワード (メール OTP や SMS OTP を含む広義語。いずれも提供しない), 認証コード (**Magic Link** の token と紛らわしい)

**MFA チャレンジ**:
一次認証は成功したが第二要素はまだ検証していない、という中間状態そのもの。署名付き cookie `mfa_login_challenge` と **TTL store** の 1 key (TTL 600 秒) で 1 つのチャレンジを構成し、cookie が持つ challengeId で識別する。発行時点で一次認証が作った **session** は破棄するため、チャレンジが保留中の user は consumer app からは未認証に見える。通過手段は **TOTP** コードまたは **リカバリーコード**。詳細: ADR-0016。
_Avoid_: 2FA チャレンジ, 二段階認証画面 (画面は状態の表現の一つに過ぎない), pending session (session は存在しないため誤り)

**kill switch**:
**MFA チャレンジ** の強制を運用側で止める環境変数 (`MFA_CHALLENGE_ENABLED`)。値が `"false"` の時だけ止まり、未設定を含む他の値では強制する (fail-safe の既定)。止まっている間は一次認証だけで **session** が確立されるため、止めている事実を一定間隔で観測に残し、気付かれないままにしない。止め方の判断と理由は ADR-0013 Consequences (ADR-0016 が引き継ぐ)。
_Avoid_: feature flag (常設の切替ではなく緊急停止の意味), disable (MFA の登録解除と紛れる)

**リカバリーコード**:
認証アプリを失った時に **MFA チャレンジ** を通過するための、1 回だけ使えるコード。**登録済み未有効** の間は同じ登録内容として再表示できるが、有効化後は残数だけを参照できる。1 本使うごとに残数が減り、再生成の導線は持たない (使い切った場合の救済は `management/disable-user-mfa.ts`)。詳細: ADR-0016。
_Avoid_: バックアップコード (better-auth の旧 `backupCodes`。twoFactor プラグインの撤去により、もう存在しない), 復旧コード, 緊急コード

**MFA 登録状態**:
`mfa_totp` 行から一意に決まる、**多要素認証 (MFA)** の登録ライフサイクルの状態。**未登録** (行なし)、**登録済み未有効** (行あり、未 verified)、**有効** (verified) の 3 状態がある。フラグ列は存在しないため、旧構成にあった「中断した有効化 / 無効化」は構造上あり得ない。詳細: ADR-0016。
_Avoid_: enrollment status (英語との混在), MFA 状態 (画面表示用の `MfaStatus` と紛らわしい), 2FA 状態 (要素数を 2 に固定する語)

**MFA 登録遷移**:
user の **MFA 登録状態** を、登録、有効化、無効化、運用救済のいずれかで移す試み。並行する遷移の決着は操作文そのもの (ON CONFLICT、条件付きの単文 UPDATE) が付け、勝者はちょうど 1 つで、敗者は既知の失敗になるか勝者の結果に収束する。**登録済み未有効** の状態で登録を再実行した場合は新しい secret を発行せず、同じ登録内容を返す。詳細: ADR-0016。
_Avoid_: MFA transition (英語との混在), MFA 操作 (状態を変えない参照まで含む広義語)

**MFA 登録識別子**:
1 回の登録開始で生まれ、有効化が対象とする登録内容を識別する不透明な値。**登録済み未有効** の状態で登録を再実行すると同じ値を返し、無効化後の新しい登録では別の値になる。有効化はこの値の一致を要求する。詳細: ADR-0016。
_Avoid_: enrollment generation (実装方式を表す語), two_factor ID (永続化の形式を外向きに漏らす語)

**MFA 運用救済**:
認証アプリと **リカバリーコード** の両方を失った user を、運用者が本人のコード検証なしに、復帰できる **MFA 登録状態** へ戻す **MFA 登録遷移**。user の session / Actor を使う self-service の無効化とは区別する。詳細: ADR-0016。
_Avoid_: 強制解除 (何を強制するか曖昧), force disable (コードの識別子としてだけ使う), 救済スクリプト (実装形態の名前)

**試行枠**:
window 内の試行回数の上限。**auth ホスト** が **TTL store** の計数で守る防御で、数えられない時に拒否と通過のどちらにするか (**fail-closed / fail-open**) を経路ごとに明示して決め、暗黙の既定を持たない。fail-closed にするのは **多要素認証 (MFA)** のコード検証 (ログインチャレンジと無効化)。fail-open にするのは HTTP 経路別の IP / session 軸 (**Magic Link**、canary token、**MFA チャレンジ** の API、MFA 状態変更) と **事業所** 単位の招待。code 上の「rate limit」(HTTP 429 を返す middleware) と「quota」(招待) は同じ概念の別名で、設計語彙では **試行枠** に統一する。MFA だけを fail-closed にする理由は ADR-0013 Consequences (ADR-0016 が引き継ぐ)。
_Avoid_: rate limit / quota / attempt budget (code の識別子に残る別名。設計語彙では使わない), throttling (より広義)

**fail-closed / fail-open**:
判断材料が得られない時 (**TTL store** で数えられない、**session** から actor を解決できない) に、拒否と通過のどちらを選ぶか。fail-closed は拒否し、fail-open は通す。auth は事業の critical path なので、通しても防御が消えない **試行枠** は availability を優先して fail-open にし、通すと第二要素の総当たりへの防御が消える MFA の試行枠と、認可の入口 (**membership guard** の actor 解決) は fail-closed にする。未知の role は状態として存在しない (**role** の項)。fail-open で通した事実は Sentry に残し、気付かれないまま通すことはしない。
_Avoid_: fail-safe (拒否と通過のどちらを選ぶかを示さない), graceful degradation (どちらを選ぶかではなく体験の話)

**session**:
better-auth が管理する認証状態。Cookie (`.taimei-code.com` ドメイン) で識別し、実体は **TTL store** だけに保管する。`session.storeSessionInDatabase` を有効にしていないため、Postgres の `session` テーブルには行を書かない (テーブル定義は better-auth の schema 要求として残す)。server 側では `auth.api.getSession({ headers })` で取得する。
_Avoid_: 認証状態 (より広義), Cookie (識別子に過ぎない)

**TTL store**:
TTL 付きの短命な状態 (**session**、verification、**試行枠** の計数、**MFA チャレンジ**) を置く store。Workers では Durable Objects、Bun では in-memory を使う。Postgres には書かない。entry はすべて TTL を持ち、失効は store 側が行う。詳細: ADR-0019。
_Avoid_: Redis (2026-09 に撤去した実装名), secondaryStorage (better-auth の API の語), KV (Cloudflare KV と紛らわしく、結果整合の含意がある), cache (失うと session が消えるので cache ではない), 揮発 store (Durable Objects は永続)

**session cookie**:
**session** を識別する署名付き cookie (`better-auth.session_token`、HTTPS では `__Secure-` 接頭辞)。発行者は 2 つあり、通常ログイン (better-auth) と **MFA チャレンジ** 通過後の発行 (`src/mfa/gateway.ts`) である。Set-Cookie に入る値はどちらも percent-encoding 済みの署名付き値で、属性 (Max-Age / Path / Domain / HttpOnly / Secure / SameSite) も 2 つの発行者で同一である。`@taimei-code/auth-client` と consumer app は値の中身を解釈せず、decode も encode もしない。値の形式と属性の同一性は `src/__tests__/session-cookie-contract.test.ts` が固定する。
_Avoid_: session token (署名を除いた **TTL store** の key の方), session (識別される状態の方)

**sign-out**:
ユーザー自身が `auth.api.signOut()` を呼び、現在の **session** を意図的に終了する操作。Cookie (session token と cookieCache) の削除と、**TTL store** 上の session の削除を伴う (Postgres の `session` 行は書いていないので削除対象も無い)。UI の文言は「ログアウト」(既存のボタンラベルと失敗トーストもこれに合わせる)。設計とコードの語彙は sign-out。
_Avoid_: logout (英語との混在を避ける), session 終了 (より広義)

**session revoke**:
better-auth の lifecycle hook や admin の操作によって、user 自身の意思とは独立に **session** を強制的に無効化する操作。`session.revoked_at` 列に時刻を記録し、VerifySession が `RESULT_REVOKED` を返す状態にする。**sign-out** (ユーザーの自発) と対比される。契機は password change や account delete などの security-sensitive な操作。
_Avoid_: invalidate (より広義), terminate, kill

**Service Key**:
consumer app が **auth ホスト** の `/rpc/*` を呼ぶ時に提示する、service 間認証の shared secret (`X-Service-Key` header、env `AUTH_SERVICE_KEY`)。end user の **session** とは独立で、consumer app の server 側だけが持つ。rotation のため、active と previous (`AUTH_SERVICE_KEY_PREVIOUS`) の 2 本を同時に受理する。未設定の時は、production では **fail-closed** (503) にし、非 production では service 認証を止めて通す (これは **kill switch** と同種の運用上の無効化であり、判断材料が得られない時の **fail-open** ではない)。手順: `docs/runbook/service-key-rotation.md`。
_Avoid_: API key (end user 向けの credential と紛らわしい), shared secret (`AUTH_SECRET` と衝突する), サービスキー (カタカナ表記の混在)

**membership guard**:
**アカウント管理画面** 系の操作 API (**auth ホスト** の `/api/account/*`) の認可の入口 (`src/membership/guard/` directory module)。**session** からの actor 解決 (**fail-closed**: 解決に失敗したら拒否する) と、**membership** の存在および **role** 階層 (OWNER > ADMIN > MEMBER) に基づく操作可否の判定を一手に受け持つ。target 側の role 規則 (OWNER への操作は OWNER のみ、など) の policy 判定も同じ語で指す。認可の入口は 2 系統ある。generic entry (`requireActor` / `requireMembership` / `requireMembershipOf`) と、operation 単位の entry (`requireRoleChange` / `requireRemoval` / `requireTransferOwnership` / `requireInvite` / `requireInvitationAccept`) である。後者は 401、400、403、404 の順で、target 側の canChangeRole / canInviteRole / canAttemptRemoval / canRemoveTarget まで含めた 1 回の回答を返し、handler が Effect program として合成した結果を adapter (`runRoute`) が HTTP に変換する。詳細: ADR-0012 / ADR-0017。
_Avoid_: RBAC (一般語で実体を指さない), authorization (より広義), 認可ミドルウェア (実装形態の名前)

**audit log**:
user の意図した action (**sign-in** / **sign-out** / account delete など) を append-only で記録する DB テーブル (`audit_log`)。**session revoke** などの内部の state change は記録しない (action の結果として暗黙に推定できる)。forensic 用途を想定し、`session` の cascade delete で失われる IP と userAgent も payload に保存する。
_Avoid_: event log (より広義), activity log

**audit event**:
**audit log** に記録する 1 行。`event_type` は user action の分類に限る (現状 `sign_in` / `sign_out` / `account_delete` / `company_created` / `company_updated` / `company_deleted` / `invitation_sent` / `invitation_accepted` / `invitation_accept_rejected` / `invitation_revoked` / `role_changed` / `membership_removed` / `ownership_transferred` / `company_switched` / `mfa_enabled` / `mfa_disabled`)。`invitation_accept_rejected` だけは user の意図ではなくシステム側の防御が発火した記録 (ADR-0012 の OWNER 招待再検証 / double_accept) だが、他の user action の event と対称に扱う (発火と非発火の両方を同じように観測できるようにするため)。詳細: ADR-0012 / ADR-0016。
_Avoid_: log entry, audit record

**best-effort 記帳**:
記帳に失敗しても操作の成立を取り消さない、**audit event** の記帳。記帳を成立条件にすると audit 保存の障害がそのまま user の操作の失敗になるので、失敗は Sentry に集約し、操作の応答は変えない。同じ transaction の中で書き、失敗すれば操作ごと rollback する「tx 内記帳」と対になる。sign-in、sign-out、MFA の有効化と無効化、`invitation_accept_rejected` がこちらに当たる。
_Avoid_: fire-and-forget (同期か非同期かは別の判断で、best-effort とは直交する), 非同期記帳

## Relationships

- **共通ログイン画面** ↔ **共通サインアップ画面**: 相互リンクで往復でき、`service_name` / `redirect_url` / `sign_up_url` は引き継がれる
- **`/login` ショートカット** → **共通ログイン画面**: 内部 302 で `service_name=accounts&redirect_url=<auth>/account` を組み立てる
- **session-aware redirect**: `/` と `/login` の 2 つの entry だけに適用する (server-side)。session があれば `/account` へ 302 し、無ければ通常フローに進む
- **TAIMEI_SERVICES** ⊃ **service_name** ∈ {`taimei`, `accounts`}
- **redirect_url** / **sign_up_url**: 必ず `TAIMEI_SERVICES[service_name].allowedHostPattern` の host を満たす必要がある
- 1 つの **session** は複数回の **共通ログイン画面** 訪問にまたがって有効である (Cookie で識別)
- **多要素認証 (MFA)** を有効にした user では、一次認証 (**Magic Link** / GitHub OAuth) の成功は **session** ではなく **MFA チャレンジ** を作る。**session** はチャレンジ通過時に初めて確立される
- **MFA チャレンジ** の通過手段は **TOTP** コードと **リカバリーコード** の 2 つ。どちらも同一チャレンジに対して 1 回だけ有効
- **多要素認証 (MFA)** の有効化と無効化は、操作した **session** 以外を **session revoke** する
- **MFA 登録状態** (3 状態) が、MFA の登録 / 有効化 / 無効化を受理するかどうかと、セキュリティページの表示を一元的に決める

## Example dialogue

> **Dev**: 「**共通ログイン画面** で Magic Link 送信中に、ユーザーが「新規登録」リンクを押したら?」
> **Domain expert**: 「`magicLinkSent === true` の状態ならリンクは隠す。送信中は完了待ちのフローを優先する」
> **Dev**: 「**`/login` ショートカット** に来た時、既に **session** が valid なら?」
> **Domain expert**: 「**session-aware redirect** で `/account` に直接 302 する。共通ログイン画面を経由させない」
> **Dev**: 「**共通ログイン画面** に認証済みのまま直接訪問したら?」
> **Domain expert**: 「form は出るが何もしない。直接訪問は edge case として黙認する。`/` と `/login` 経由で 95% は救済できている」

## Flagged ambiguities

- 「ログイン画面」が「共通ログイン画面」(**共通画面 SPA** の `/auth/`) と「`/login` ショートカット URL」の両方に解釈される時期があった。解決済み: 前者を **共通ログイン画面**、後者を **`/login` ショートカット** に canonical 化した
- 初期は「Layer A」「Layer B」という順序ラベルで server と client を区別していたが、内容を示さない抽象的な表現だったため廃止した。server 側は **auth ホスト**、client 側は **共通画面 SPA** に canonical 化した
- 「callbackURL」は better-auth API の引数名としてはそのまま使うが、設計の議論では **redirect_url** を使う。better-auth の内部では callbackURL、外部 (URL クエリ) では redirect_url である
- 「after-signin」「after-signup」は **proxy 側 path** (例: taimei の `/auth/after-signin` Controller) を指す別の概念である。taimei-auth 側の **redirect_url** / **sign_up_url** とは指す対象が違うので混同しない
- 「twoFactor」「backupCodes」「`2fa-*`」は、twoFactor プラグインの撤去により、テーブル名、列名、API 名、cookie 内の識別子としてはもう存在しない。設計語彙と自前の識別子では **多要素認証 (MFA)** / **リカバリーコード** を使う。残る借用はテスト内の語彙検査だけである
- 「Auth」は better-auth の instance (`auth`、ESM live binding) と、それを包む Effect service の両方に読めた。解決済み: service は `AuthApi` に一本化し、instance を `Auth` と呼ばない。Effect 導入で増えた実装語彙 (Transport adapter / boundary error / ports・wiring / `WireFailure`) はドメイン語ではないためこの glossary には置かず、定義元は ADR-0017 とする
- 「wire」(client が受け取る応答の byte 列) は日本語話者に意味が取りづらく、定義もどこにも無かった。解決済み: 2026-09 に code の識別子を `ClientFacingError` / `ClientFacingErrorShape` / `clientFacingErrorResponse` / `parseClientFacingError` / `MfaClientFacingErrorCode` (`src/handlers/client-facing-error.ts` / `src/mfa/client-facing-contracts.ts`) へ改名した。client-facing とは中身を client に開示する失敗 (`error` code と `status` をそのまま応答にする) を指し、対比は internal (BoundaryError / defect。Sentry に送り、500 の固定文を返す) である。線引きは 4xx / 5xx ではなく開示の有無で決まる (`ServiceKeyMisconfigured` は 503 だが client-facing)。ADR-0017 の「wire」は旧名として読む
- 「actor」は **membership guard** の「session からの actor 解決」の主体を指す。MFA 実装の `MfaActor` 型はその 3 フィールドだけを取り出した実装型であり、別のドメイン概念ではない。解決済み: 旧 `RegistrationPrincipal` を廃し、主体の語彙を actor に一本化した
- 「rate limit」「quota」「attempt budget」が code 上で並存し、どれも同じ「window 内の試行上限」を指していた。解決済み: 設計語彙は **試行枠** に統一し、code の識別子は別名として据え置いた
- 「Redis」は 2026-09 まで **TTL store** の実装名 (Upstash / node-redis) で、glossary でも保存先を指す語として使っていた。解決済み: 実装を Durable Objects / in-memory に替えた (ADR-0019) 際に **TTL store** を canonical 化した。code の識別子も `ttl-store.ts` / `TtlStore` service / `TtlStoreError` へ改名済みである (`/health` の check key は `ttlStore`)
