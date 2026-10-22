# taimei-auth

taimei-auth は、taimei エコシステム全体で共有する認証サービスである。複数の **プロダクト** (taimei 本体、accounts など) からの認証要求を一箇所で処理する。

## Language

### 事業所 / ドメイン主体

**事業所 (company)**:
taimei における課金単位であり、user の所属先でもあるドメイン主体。1 つの法人格または個人事業主が 1 事業所として登録される。1 user は **membership** を介して複数の事業所に所属できる (N:M)。個人事業主と法人は **事業所の種別** で区別する。
_Avoid_: 組織 / organization (より広義で、tenant と意味が重なる), 事業者 / merchant (EC 寄りの語感), tenant (事業所とは別の、内部の識別のための概念)

**membership**:
1 user が 1 **事業所** に所属する関係。**role** を持ち、membership があること自体が確定した所属を表す。招待中という状態は持たず、まだ受諾されていない招待は **invitation** として別に扱う。離脱と除名では membership を消し、**audit log** に記録を残す。設計とコードでは英語の membership を使う。
_Avoid_: メンバーシップ (カタカナ語で、UI では冗長), affiliation (より広義), association (DB の関係の意味と衝突する), 招待状態 (membership は招待中の状態を持たない)

**現在の事業所 (current company)**:
user が今操作の対象にしている 1 つの **事業所**。consumer app は auth-client を通じてこの事業所を受け取る。所属を得るとその事業所になり、現在の事業所の所属を失うと残る所属のどれかになり、所属が 0 件になると無くなる。**アカウント管理画面** で切り替えられる。
_Avoid_: default company / last used company (保存と受け渡しに使う名前で、概念の名前ではない), active company (同義語で、混在させない)

**事業所の状態 (activation status)**:
**事業所** が使える (ACTIVE) か、削除された (DELETED) かを表す状態。削除した事業所は記録を残したまま削除済みになり、利用者が元に戻す手段は無い (戻せるのは運用者だけ)。記録ごと消す削除はまだ無く、保存期間の方針が決まるまで保留している。詳細: ADR-0010。
_Avoid_: status (より広義), state (将来、招待中など別の軸の状態と紛らわしい), deleted (削除済みかどうかの 2 値に狭めてしまう)

**事業所の種別 (org code)**:
**事業所** が個人事業主 (PERSONAL) と法人 (CORPORATE) のどちらかを表す区分。変えられるのは OWNER だけで、変えた時は変更の前後を **audit event** に残す。
_Avoid_: company_type (より広義), business_type (業種と紛らわしい)

**メンバー (member)**:
ある **事業所** の **membership** を持つ user を、その事業所の文脈で呼ぶ UI 上の呼称。「メンバーを事業所から削除」は membership を消すことを意味し、user 本体は残る。動詞句で範囲を明示して、user 本体の削除と読み違えないようにする。consumer app は auth-client を通じて **現在の事業所** のメンバー一覧を受け取る。また **Service Key** を使って、自分が知る user が今もその事業所のメンバーか、その事業所が使えるかを確かめられる。
_Avoid_: ユーザー (より広義で、事業所をまたぐ user を指す時に使う), メンバーシップ (関係の方を指す時は **membership**)

**role**:
**membership** が表す権限の階層。OWNER / ADMIN / MEMBER の 3 段階がある。事業所の削除、課金の変更、OWNER 権限の委譲は OWNER だけが行える。ADMIN は OWNER を作れず、自分を昇格させることもできない (OWNER への昇格を承認できるのは OWNER だけである)。1 事業所に複数の OWNER を置けるが、OWNER は常に 1 人以上いなければならない。最後の OWNER を減らす操作 (降格、除名、退会) は拒否される。**membership** と **invitation** の role は常にこの 3 値のいずれかで、未知の role という状態は存在しない。consumer app は auth-client を通じて **現在の事業所** での role を受け取る。詳細: ADR-0010 / ADR-0018。
_Avoid_: 役職 (人事ドメインの語と紛らわしい), permission (個別の操作の認可と混同する), member_type (業種の分類と紛らわしい)

**退会**:
user が自分の要求で自分のアカウントを削除する操作。所属するすべての事業所から抜け、アカウントは復元できない。使える事業所の唯一の OWNER である間は拒否される。事業所から 1 つだけ抜ける操作は退会ではなく、自分を対象にした除名である。所属が 0 件になったアカウントをシステムが削除する場合 (ADR-0010) も退会とは呼ばない。どちらの削除も **audit event** を残す。

**invitation**:
**事業所** から外部の email 宛に出す、メンバー参加の打診 1 件。有効期限は 24 時間で、状態は未対応 (PENDING)、受諾済み (ACCEPTED)、取消済み (REVOKED) のいずれかである。受諾されると **membership** を新しく作る (招待中の membership は作らない)。取消は invitation の状態の変化と **audit event** で表す。期限切れは状態を変えない。期限を過ぎた未対応の招待は受諾できず、未対応の一覧にも出ない。
_Avoid_: 招待状態 (membership に招待中の状態を持たせる形。採らなかった), pending member (状態の表現と紛らわしい)

### 認証画面 (共通画面 SPA)

**共通ログイン画面**:
複数の **プロダクト** が共有して使う、認証の起点となる画面 (`/auth/`)。**共通画面 SPA** が出す画面の 1 つである。
_Avoid_: ログイン画面, SignIn 画面, `/auth/`

**共通サインアップ画面**:
新規ユーザー登録のための、ログイン画面と対になる画面 (`/auth/signup`)。名前の入力欄が加わること以外は、**共通ログイン画面** と同じ **Magic Link** / GitHub OAuth の経路を提供する。
_Avoid_: SignUp 画面, 新規登録画面, サインアップ

**アカウント管理画面**:
ログイン後にプロフィール、セキュリティ、セッション、連携アカウントを管理する画面 (`/account/*`)。**共通画面 SPA** が出す 3 つ目の画面群である。
_Avoid_: マイページ, account ページ

**エラー画面**:
認証の流れを続けられない時に、理由を示す画面 (`/auth/error`)。**共通画面 SPA** が出す画面の 1 つである。**プロダクト** が利用者をこの画面へ移す時に付けられる理由は、ログインの失敗と、登録済みの 2 つである。
_Avoid_: error page, エラーページ

**auth ホスト**:
`auth.taimei-code.com` への HTTP の要求をすべて受ける、taimei-auth の server。IdP、consumer app 向けの RPC、**`/login` ショートカット**、ヘルスチェック、**共通画面 SPA** の配信を同じ host で受け持つ。**共通画面 SPA** からの要求と consumer app からの RPC の両方を受ける。
_Avoid_: Layer A (順序ラベルで内容を示さない), バックエンド, server (より広義), Hono server (実装名なので抽象を表せない)

**共通画面 SPA**:
**auth ホスト** が `/auth/*` と `/account/*` で配信する、ブラウザで動く 1 つの画面アプリ。**共通ログイン画面** / **共通サインアップ画面** / **アカウント管理画面** の 3 系統に分かれる。詳細: ADR-0002。
_Avoid_: Layer B (順序ラベルで内容を示さない), フロント, クライアント, Web UI (より広義)

**canary token**:
**共通画面 SPA** のログイン画面とサインアップ画面に仕込む、通常のユーザーが触れない識別子。見えないリンク、隠しの入力欄、favicon の URL の 3 か所に埋め込み、アクセスがあればフィッシングサイトによる画面の複製 (DOM の読み取り、form の自動送信、favicon の先読み) の試行として通報する。攻撃者に手がかりを与えないよう、応答には中身を返さない。詳細: ADR-0005。
_Avoid_: ハニーポット (より広義), ビーコン

### URL 構築 / 経路

**`/login` ショートカット**:
taimei-auth 自身の **アカウント管理画面** へ向かうログインを始める入口 (`auth.taimei-code.com/login`)。**service_name** を **accounts** に、**redirect_url** を **アカウント管理画面** にして **共通ログイン画面** へ移す。
_Avoid_: ログイン入口, login redirect

**session-aware redirect**:
ログインの入口 (`/` と `/login`) を訪れた時に、**session** があれば **アカウント管理画面** へ移し、無ければ通常の認証の流れに進ませる、server 側の振る舞い。user が削除された後に残った session は、session が無いとみなす。**共通ログイン画面** / **共通サインアップ画面** への直接の訪問には適用しない (多数派である未認証ユーザーに負担をかけないため)。
_Avoid_: auto redirect, 自動リダイレクト

**sign 流**:
**プロダクト** 側でログイン画面の URL (**service_name** と **redirect_url** を付けたもの) を組み立て、taimei-auth は移ってよい host かどうかの検証だけを行う方式。ログイン後の遷移先を認証サービス側で決める中央集権型と対比される。
_Avoid_: 共通ログイン pattern (両方の方式を含むため曖昧)

### プロダクトと URL のパラメータ

**プロダクト**:
共通ログイン基盤を使う製品。プロダクトごとに、表示名、ログイン後に移ってよい host、検索エンジンに載せるかどうかを決めて登録する。**service_name** で識別する。
_Avoid_: TAIMEI_SERVICES (登録の一覧を指すコード上の名前), services map, product registry

**service_name**:
**プロダクト** を識別する名前。ログイン画面の URL に付けて、要求元のプロダクトを示す。現状は **taimei** と **accounts** の 2 つ。
_Avoid_: product, app

**taimei**:
**service_name** の 1 つで、taimei 本体のプロダクト (`app.taimei-code.com`) を指す。
_Avoid_: app

**accounts**:
**service_name** の 1 つで、taimei-auth 自身の **アカウント管理画面** を 1 つのプロダクトとして扱うための名前。
_Avoid_: account service (混同しやすい), taimei-auth itself

**redirect_url**:
認証が済んだ後にユーザーが移る、**プロダクト** 側の URL。**service_name** のプロダクトに登録した host でなければ受け付けない。**メンバー** の画面も **service_name** と組で受け取り、そこから出す **invitation** のリンクに載せる。招待された人は受諾の後にこの URL へ移り、組が無いか検証に通らなければ **アカウント管理画面** に移る。招待に載せる URL には query と fragment を付けない (付けても受諾後の遷移先には残らない)。
_Avoid_: callbackURL (外部ライブラリの API の語), destination, 戻り先

**sign_up_url**:
新規登録が済んだ後の遷移先の URL (通常はプロダクトの初期設定の画面)。**共通サインアップ画面** でだけ意味を持ち、指定が無ければ **redirect_url** を使う。
_Avoid_: onboarding URL, after-signup URL (こちらはプロダクト側の path を指す別の概念)

### 認証手段 / セッション

**Magic Link**:
メールアドレス宛に送る、1 回だけ使えるログイン用のリンク。開くと本人の確認、**session** の確立、**redirect_url** への移動までが済む。有効期限は 5 分で、consumer app は auth-client を通じてこの値を受け取る。
_Avoid_: メールリンク

**新規登録の直後**:
user が作られてから、**Magic Link** の有効期限と同じ長さの時間が経つまでの間。consumer app は auth-client を通じてこの判定を受け取る。
_Avoid_: 初回ログイン (その間の 2 回目のログインも含むため), 事業所の未作成 (**事業所** を作っていない状態は別の判定)

**多要素認証 (MFA)**:
知識、所持、生体のうち 2 つ以上の要素で本人であることを確認する仕組み。taimei-auth では認証アプリ (**TOTP**) を第二要素として提供し、一次認証 (**Magic Link** / GitHub OAuth) の成功後に **MFA チャレンジ** を要求する。user 単位の任意設定であり、**事業所** による強制は持たない。有効化と無効化のどちらも本人へ通知メールを送る。詳細: ADR-0016。
_Avoid_: 2FA / 二要素認証 (要素数を 2 に固定する語。第二要素が増えた時に成り立たなくなる), twoFactor (撤去した外部ライブラリの機能名)

**TOTP**:
認証アプリが共有の secret と現在時刻から 30 秒ごとに作る 6 桁のワンタイムコード (RFC 6238)。taimei-auth が提供する唯一の第二要素で、QR コードの読み取りか secret の手入力で登録する。secret は暗号化して保管し、暗号の鍵は入れ替えられる。詳細: ADR-0016。
_Avoid_: OTP / ワンタイムパスワード (メールや SMS で送るコードを含む広義語。いずれも提供しない), 認証コード (**Magic Link** のリンクと紛らわしい)

**MFA チャレンジ**:
一次認証は成功したが第二要素はまだ確かめていない、という中間状態そのもの。有効期間は 10 分で、署名付きの cookie で 1 つのチャレンジを識別し、状態は **TTL store** に置く。発行した時点で一次認証が作った **session** は破棄するため、チャレンジが保留中の user は consumer app からは未認証に見える。通過手段は **TOTP** のコードか **リカバリーコード**。詳細: ADR-0016。
_Avoid_: 2FA チャレンジ, 二段階認証画面 (画面は状態の表現の一つに過ぎない), pending session (session は存在しないため誤り)

**kill switch**:
**MFA チャレンジ** の強制を運用者が止めるための切り替え。明示して止めた時だけ止まり、設定が無い時は強制する (安全側の既定)。止まっている間は一次認証だけで **session** が確立されるため、止めている事実を一定の間隔で記録に残し、気付かれないままにしない。止め方の判断と理由は ADR-0013 Consequences (ADR-0016 が引き継ぐ)。
_Avoid_: feature flag (常設の切替ではなく緊急停止の意味), disable (MFA の登録解除と紛れる)

**リカバリーコード**:
認証アプリを失った時に **MFA チャレンジ** を通過するための、1 回だけ使えるコード。**登録済み未有効** の間は同じ登録内容として再表示できるが、有効化の後は残りの数だけを見られる。1 本使うごとに残りが減り、作り直す手段は持たない (使い切った時は **MFA 運用救済** で戻す)。詳細: ADR-0016。
_Avoid_: バックアップコード (撤去した外部ライブラリの語), 復旧コード, 緊急コード

**MFA 登録状態**:
**多要素認証 (MFA)** の登録の段階。**未登録**、**登録済み未有効** (登録したが、まだコードを確かめていない)、**有効** (コードを確かめた) の 3 状態がある。中断した有効化や無効化という中間の状態は持たない。詳細: ADR-0016。
_Avoid_: enrollment status (英語との混在), MFA 状態 (画面に出す表示の区分と紛らわしい), 2FA 状態 (要素数を 2 に固定する語)

**MFA 登録遷移**:
user の **MFA 登録状態** を、登録、有効化、無効化、**MFA 運用救済** のいずれかで移す試み。並行して起きた遷移は 1 つだけが成功し、他は既知の失敗になるか、成功した遷移の結果に揃う。**登録済み未有効** の状態で登録をやり直した場合は新しい secret を発行せず、同じ登録内容を返す。詳細: ADR-0016。
_Avoid_: MFA transition (英語との混在), MFA 操作 (状態を変えない参照まで含む広義語)

**MFA 登録識別子**:
1 回の登録開始で生まれ、有効化の対象となる登録内容を識別する値。**登録済み未有効** の状態で登録をやり直すと同じ値を返し、無効化の後の新しい登録では別の値になる。有効化はこの値の一致を要求する。詳細: ADR-0016。
_Avoid_: enrollment generation (実装方式を表す語), two_factor ID (保存の形式を外に漏らす語)

**MFA 運用救済**:
認証アプリと **リカバリーコード** の両方を失った user を、運用者が本人のコードの確認なしに、復帰できる **MFA 登録状態** へ戻す **MFA 登録遷移**。本人が自分の **session** で行う無効化とは区別する。詳細: ADR-0016。
_Avoid_: 強制解除 (何を強制するか曖昧), force disable (コードの識別子としてだけ使う), 救済スクリプト (実装形態の名前)

**試行枠**:
一定の時間内に試せる回数の上限。**auth ホスト** が **TTL store** で回数を数えて守る防御で、数えられない時に拒否と通過のどちらにするか (**fail-closed / fail-open**) を経路ごとに明示して決め、暗黙の既定を持たない。fail-closed にするのは **多要素認証 (MFA)** のコードの確認 (ログイン時のチャレンジと無効化)。fail-open にするのは、経路ごとの IP や session 単位の上限 (**Magic Link**、**canary token**、**MFA チャレンジ** の API、MFA の状態の変更) と、**事業所** 単位の招待の上限である。code の名前は attempt budget で、別名は上限に達した時に client へ返す失敗の `RateLimited` だけである (SPA の契約の `_tag` で、client が読むので変えない)。MFA だけを fail-closed にする理由は ADR-0013 Consequences (ADR-0016 が引き継ぐ)。
_Avoid_: rate limit (以前の code の名前), throttling (より広義)

**fail-closed / fail-open**:
判断材料が得られない時 (**TTL store** で数えられない、**session** から actor を決められない) に、拒否と通過のどちらを選ぶか。fail-closed は拒否し、fail-open は通す。auth は事業の critical path なので、通しても防御が消えない **試行枠** は availability を優先して fail-open にし、通すと第二要素の総当たりへの防御が消える MFA の試行枠と、認可の入口 (**membership guard** の actor の決定) は fail-closed にする。未知の role は状態として存在しない (**role** の項)。fail-open で通した事実は監視に残し、気付かれないまま通すことはしない。
_Avoid_: fail-safe (拒否と通過のどちらを選ぶかを示さない), graceful degradation (どちらを選ぶかではなく体験の話)

**session**:
user がログインしている状態。cookie (`taimei-code.com` の各サブドメインで共有) で識別し、実体は **TTL store** だけに置く。user や **事業所** の記録には置かない。
_Avoid_: 認証状態 (より広義), Cookie (識別子に過ぎない)

**TTL store**:
有効期限のある短命な状態 (**session**、**Magic Link** の確認用の値、**試行枠** の計数、**MFA チャレンジ**) を置く保管先。すべての値が有効期限を持ち、期限が切れた値は保管先が消す。本番では DB に置かない。**試験の環境** では user の記録と同じ DB に置く (理由: ADR-0020 の Decision 6)。詳細: ADR-0019。
_Avoid_: Redis (2026-09 に撤去した実装の名前), secondaryStorage (外部ライブラリの API の語), KV (結果整合を含意する別の製品と紛らわしい), cache (失うと session が消えるので cache ではない), 揮発 store (永続の実装もある)

**session cookie**:
**session** を識別する署名付きの cookie。発行する経路は 2 つあり、通常のログインと、**MFA チャレンジ** を通過した後の発行である。2 つの経路で、値の形式 (署名付きで percent-encoding 済み) と属性 (Max-Age / Path / Domain / HttpOnly / Secure / SameSite) は同じである。auth-client と consumer app は値の中身を解釈せず、decode も encode もしない。
_Avoid_: session token (署名を除いた、**TTL store** の鍵の方), session (識別される状態の方)

**sign-out**:
ユーザー自身が現在の **session** を意図して終える操作。cookie の削除と、**TTL store** 上の session の削除を伴う。UI の文言は「ログアウト」(ボタンや失敗の通知もこれに合わせる)。設計とコードの語彙は sign-out。
_Avoid_: logout (英語との混在を避ける), session 終了 (より広義)

**session revoke**:
user 自身の意思とは独立に、**session** を **TTL store** から消して無効にする操作。**sign-out** (ユーザーの自発) と対比される。契機は **多要素認証 (MFA)** の有効化と無効化 (操作した session 以外が対象) と、アカウントの削除 (退会と、所属が 0 件になったアカウントの削除。手順: ADR-0010)。アカウントの削除では、user の削除を確定した後に session を消す。消えた session は、consumer app からは存在しない session に見える。
_Avoid_: invalidate (より広義), terminate, kill

**Service Key**:
consumer app が **auth ホスト** の RPC を呼ぶ時に示す、サービス間の認証のための共有の秘密の値。end user の **session** とは独立で、consumer app の server 側だけが持つ。入れ替えのため、新旧の 2 本を同時に受け付ける。設定されていない時は、本番では **fail-closed** にし、本番以外ではサービス間の認証を止めて通す (これは **kill switch** と同種の運用上の無効化であり、判断材料が得られない時の **fail-open** ではない)。手順: `docs/runbook/service-key-rotation.md`。
_Avoid_: API key (end user 向けの credential と紛らわしい), shared secret (認証全体の署名の鍵と紛らわしい), サービスキー (カタカナ表記の混在)

**membership guard**:
**アカウント管理画面** の操作の認可の入口。**session** から操作する人 (actor) を決め (決められなければ拒否する。**fail-closed**)、**membership** があるかと **role** の階層 (OWNER > ADMIN > MEMBER) から操作できるかを判定する。操作の相手側の role の規則 (OWNER への操作は OWNER だけ、など) の判定も同じ語で指す。詳細: ADR-0012 / ADR-0017。
_Avoid_: RBAC (一般語で実体を指さない), authorization (より広義), 認可ミドルウェア (実装形態の名前)

**SPA の API 契約**:
**共通画面 SPA** が呼ぶ API の、endpoint、受け取る値、成功の応答、失敗をまとめた宣言。**auth ホスト** と **共通画面 SPA** は同じ宣言を読み、画面は失敗の種類ごとに文言を選ぶ。CSRF の検査と MFA の **試行枠** も、宣言した endpoint に付いて動く。詳細: ADR-0017「SPA の API 契約」。
_Avoid_: API 定義, schema (一般語で、別の schema と紛らわしい), 契約 (単独では他の契約と区別できない)

**audit log**:
user が意図した操作 (ログイン、退会など) を、追記だけで記録する履歴。**sign-out** は記録しない。**session revoke** などの内部の状態の変化も記録しない (操作の結果から推定できる)。調査に使うことを想定し、IP と userAgent も残す。
_Avoid_: event log (より広義), activity log

**audit event**:
**audit log** に記録する 1 件。種類は user の操作の分類に限る (ログイン、退会、事業所の作成・変更・削除、招待の送信・受諾・受諾の拒否・取消、role の変更、メンバーの削除、OWNER の委譲、**現在の事業所** の切り替え、MFA の有効化・無効化)。招待の受諾の拒否だけは user の意図ではなく、システム側の防御が働いた記録 (ADR-0012 の OWNER 招待の再検証と二重の受諾) だが、他の操作と同じように扱う (働いた時と働かなかった時を同じように観測できるようにするため)。詳細: ADR-0012 / ADR-0016。
_Avoid_: log entry, audit record

**best-effort 記帳**:
記帳に失敗しても操作の成立を取り消さない、**audit event** の記帳。記帳を成立の条件にすると、audit の保存の障害がそのまま user の操作の失敗になるので、失敗は監視に集め、操作の応答は変えない。同じ transaction の中で書き、失敗すれば操作ごと取り消す「tx 内記帳」と対になる。ログイン、MFA の有効化と無効化、招待の受諾の拒否がこちらに当たる。
_Avoid_: fire-and-forget (同期か非同期かは別の判断で、best-effort とは直交する), 非同期記帳

**試験の環境**:
consumer app が e2e と手元の確認のために、自分の試験と一緒に taimei-auth を動かす環境。taimei-auth の版は consumer が固定する SDK の版と同じである。taimei-auth 自身の試験はこれに当たらない。詳細: ADR-0020。
_Avoid_: e2e 環境 (手元の確認が漏れる), テスト環境 (taimei-auth 自身の試験と紛らわしい)

**試験 API**:
**試験の環境** で、資格情報なしにログイン済みの試験の利用者を作り、その **現在の事業所** を切り替えるための API。試験用に起動した時だけ開き、本番の **auth ホスト** には存在しない。
_Avoid_: test API, testing endpoint (英語の混在), backdoor (意図を誤って伝える)

**開発用アカウント**:
**試験の環境** が起動のたびにそろえる、固定の利用者と **事業所** の組。OWNER / ADMIN / MEMBER の **role** と複数の事業所への所属を持ち、何度起動しても同じ利用者と事業所である。
_Avoid_: テストユーザー (**試験 API** が作る試験の利用者と紛らわしい), seed ユーザー, dev user

**開発者ホーム**:
**試験の環境** だけにある開発用の画面 (`/dev`)。ログインしている利用者と、その所属する **事業所**・**role**・**現在の事業所** を出し、**開発用アカウント** と試験の環境にいる利用者から選んでログインし直すことと、ログアウトができる。**redirect_url** があれば、その **プロダクト** に戻れる。本番の **auth ホスト** には存在しない。
_Avoid_: アカウント選択画面 (共通ログイン画面の URL に出ていた旧称), dev admin, 管理画面 (**アカウント管理画面** と紛らわしい)

## Relationships

- **共通ログイン画面** ↔ **共通サインアップ画面**: 相互リンクで往復でき、**service_name** / **redirect_url** / **sign_up_url** は引き継がれる
- **開発者ホーム** と **共通ログイン画面** は別の URL である。**試験の環境** でも共通ログイン画面と **共通サインアップ画面** は本番と同じ画面を出す
- **`/login` ショートカット** → **共通ログイン画面**: **service_name** を **accounts** に、**redirect_url** を **アカウント管理画面** にして移す
- **session-aware redirect**: `/` と `/login` の 2 つの入口だけに適用する (server 側)。session があれば **アカウント管理画面** へ移し、無ければ通常の流れに進む
- **プロダクト** は **service_name** で識別し、現状は **taimei** と **accounts** の 2 つである
- **redirect_url** / **sign_up_url**: 必ず **service_name** のプロダクトに登録した host を指す
- **メンバー** の画面 → **invitation** → 受諾: 受諾後の遷移先は、画面が受けた **redirect_url** で決まる (詳細は **redirect_url** の項)
- 1 つの **session** は、**共通ログイン画面** への複数回の訪問にまたがって有効である (cookie で識別)
- **多要素認証 (MFA)** を有効にした user では、一次認証 (**Magic Link** / GitHub OAuth) の成功は **session** ではなく **MFA チャレンジ** を作る。**session** はチャレンジの通過時に初めて確立される
- **MFA チャレンジ** の通過手段は **TOTP** のコードと **リカバリーコード** の 2 つ。どちらも同じチャレンジに対して 1 回だけ有効
- **多要素認証 (MFA)** の有効化と無効化は、操作した **session** 以外を **session revoke** する
- **MFA 登録状態** (3 状態) が、MFA の登録、有効化、無効化を受け付けるかどうかと、セキュリティの画面の表示を一か所で決める

## Example dialogue

> **Dev**: 「**共通ログイン画面** で Magic Link を送った後に、ユーザーが「新規登録」リンクを押したら?」
> **Domain expert**: 「送った後はリンクを隠す。メールの確認を待つ流れを優先する」
> **Dev**: 「**`/login` ショートカット** に来た時、既に **session** が有効なら?」
> **Domain expert**: 「**session-aware redirect** で **アカウント管理画面** に直接移す。共通ログイン画面を経由させない」
> **Dev**: 「**共通ログイン画面** に認証済みのまま直接訪問したら?」
> **Domain expert**: 「form は出るが何もしない。直接の訪問は例外として黙認する。`/` と `/login` 経由で 95% は救えている」

## Flagged ambiguities

- 「ログイン画面」が「共通ログイン画面」(**共通画面 SPA** の `/auth/`) と「`/login` ショートカット URL」の両方に解釈される時期があった。解決済み: 前者を **共通ログイン画面**、後者を **`/login` ショートカット** に canonical 化した
- 初期は「Layer A」「Layer B」という順序ラベルで server と client を区別していたが、内容を示さない抽象的な表現だったため廃止した。server 側は **auth ホスト**、client 側は **共通画面 SPA** に canonical 化した
- 「callbackURL」は外部ライブラリの API の引数名で、設計の議論では **redirect_url** を使う。ライブラリの内部では callbackURL、URL のクエリでは redirect_url である
- 「after-signin」「after-signup」は **プロダクト** 側の path (例: taimei の `/auth/after-signin`) を指す別の概念である。taimei-auth 側の **redirect_url** / **sign_up_url** とは指す対象が違うので混同しない
- 「twoFactor」「backupCodes」「2fa-*」は、外部ライブラリの機能を撤去したため、もう使っていない。設計の語彙と自前の名前では **多要素認証 (MFA)** / **リカバリーコード** を使う
- 「actor」は **membership guard** が **session** から決める、操作する人を指す。解決済み: MFA の操作の主体も actor と呼び、別の語を作らない
- 「rate limit」「quota」「attempt budget」が code 上で並存し、どれも同じ「一定の時間内に試せる回数の上限」を指していた。解決済み: 設計の語彙は **試行枠** に統一し、code の名前も attempt budget にそろえた。残る別名は client に返す失敗の `RateLimited` だけ
- 「Redis」は 2026-09 まで **TTL store** の実装の名前で、用語集でも保管先を指す語として使っていた。解決済み: 実装を替えた (ADR-0019) 際に **TTL store** を canonical 化した
