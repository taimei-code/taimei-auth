# ADR-0013: MFA チャレンジ強制を自前プラグインで行い、twoFactor プラグイン内部形式に意図的に結合する

## Status

Accepted (2026-08-09)。`feat/mfa-totp` で実装。

## Context

`/account/security` の「多要素認証 (MFA)」を実装し、認証アプリ (TOTP) を登録したユーザーには、ログインの
一次認証が成功した後に 6 桁コードの **MFA チャレンジ** を要求する。

taimei-auth のログイン手段は **Magic Link** (`/api/auth/magic-link/verify`) と GitHub OAuth
(`/api/auth/callback/:id`) の 2 つで、`emailAndPassword` は無効 — パスワードログインは存在しない。
チャレンジを片方の経路にだけ掛けると、もう片方が MFA バイパス経路になるため、両方に掛けることが要件になる。

better-auth の twoFactor プラグインは、TOTP secret の生成・暗号化保管・コード検証・リカバリーコードの
単回消費・試行回数によるロックまでを持っている。しかし**チャレンジを差し込む after-hook は
`/sign-in/email` `/sign-in/username` `/sign-in/phone-number` の 3 path にしか match しない**。
upstream は 1.6.4 でこの範囲を意図的に縮小しており (範囲を広げた PR #9122 を revert)、将来の minor で
per-method opt-out 付きで再拡大する意向が示されている。現状のプラグインを素で載せると、本サービスの
ログイン経路ではチャレンジが 1 度も発火せず、MFA を有効にしたユーザーがそのまま素通りする。

一方で、認証の中核である「TOTP secret をどう暗号化して保管するか」「リカバリーコードをどう単回消費に
するか」「何回失敗でアカウントをロックするか」を自前で書くと、その正しさを全て自分で所有することになる。

加えて better-auth の hook 実行順は `options.hooks.after` → プラグインの after-hook (プラグイン登録順)
で、既存 `src/auth.ts` の `hooks.after` (welcome メール送信 + `sign_in` **audit event**) はチャレンジ
介入より**先に**走る。「既存 hook に条件分岐を足してチャレンジ時だけスキップする」という素直な案は、
実行順の時点で成立しない。

## Decision

### 1. ハイブリッド — 素材はプラグイン、チャレンジ強制だけ自前プラグイン

server 側にのみ twoFactor プラグイン (`allowPasswordless: true` / `skipVerificationOnEnable: false` /
`storeBackupCodes: "encrypted"`) を載せ、**チャレンジの発火だけを自前プラグイン
`src/auth-plugins/mfa-challenge.ts` が行う**。自前 after-hook は `/magic-link/verify` と
`/callback/:id` を matcher にし、MFA を有効にしたユーザーであれば

1. MFA チャレンジを発行し、
2. 一次認証で確立された **session** を破棄し (cookie クリア → `setNewSession(null)` → `deleteSession` の順)、
3. 元の 302 を `/auth/mfa` への 302 に差し替える。

介入を決めた後のあらゆる失敗は fail-closed に倒す (チャレンジ発行失敗・session 破棄途中の失敗の
いずれでも、session cookie がクリアされた状態で再ログインへ誘導し `Sentry.captureException`)。
元の 302 をそのまま通す fail-open は取らない。

3 案のトレードオフ:

| 案 | 得るもの | 払うもの |
|---|---|---|
| プラグイン素のまま | 実装コストゼロ | **チャレンジが発火しない** (要件を満たさない) |
| 全自前実装 | upstream 非依存 | secret の暗号化・コードの単回消費・試行ロック・リカバリーコードの正しさを全て自分で所有する |
| **ハイブリッド (採用)** | ロック / 暗号化 / リカバリーコードは upstream の実装のまま使う | プラグイン内部形式 (cookie 名・verification value のキー形式・署名 scheme) への結合を抱える |

ブラウザに向けた表面は自前 REST のみにする。プラグインの `/two-factor/*` 生 path は before-hook で
すべて 403 に落とし、`twoFactorClient()` も **共通画面 SPA** に入れない (自前 POST を迂回されると
`sign_in` audit event の記録とチャレンジ状態の掃除がバイパスされるため、verify 系も含めて全遮断する)。
プラグインの機能は server-side の `auth.api.*` 呼び出しからのみ使う。

### 2. 内部形式への結合を 2 ファイルに封じ込め、静的テストで固定する

意図的に結合する対象は、upstream が公開 API として保証していない次の形式である:

- 署名付き cookie `two_factor` (maxAge 600 秒)、その中の識別子 `2fa-<random20>`
- verification value のキー形式 (`2fa-<id>` → userId / `2fa-attempts-2fa-<id>` → 試行回数)
- cookie 署名 scheme (`createHMAC("SHA-256", "base64urlnopad")`。`hono/cookie` の `getSignedCookie` とは非互換)

封じ込め構造:

- **`src/mfa/challenge-store.ts`** — 上記の形式を知る唯一のファイル。チャレンジの発行 / 読み出し /
  消費をここだけが行う。`two_factor` / `2fa-` のリテラルが `src/` 内の他ファイルに現れないことを
  静的テストで固定する (`no-hono-import.test.ts` と同形)。「壊れた」しか検知できない e2e ではなく、
  「漏れた」を検知するのはこの静的テストの役割。
- **`src/mfa/gateway.ts`** — `auth.api.*` / `auth.$context` への唯一の窓口
  (`src/account/revoke-sessions.ts` の「唯一の正規窓口」規律と同形)。戻り値は plain data と転送用
  `Headers` に限り、プラグインの型や内部知識を外に出さない。
- **統合テスト** — challenge-store が作ったチャレンジ状態を gateway 経由の verify が消費できること。
  upstream が形式を変えた場合に PR の時点で落ちる。依存更新時は
  `bun test src/mfa && bun update better-auth && bun test src/mfa` で drift を確認する。

**撤退線**: upstream がチャレンジ範囲の再拡大 (per-method opt-out) を出したら、自前プラグインを捨てて
標準機構へ移行する。その時に触るのは challenge-store とプラグイン登録の 2 箇所だけで済む — これが
「1 ファイル封じ込め」に払うコストの見返りである。

### 3. sign-in の観測を自前プラグインへ移し、登録順を正しさの前提として固定する

better-auth は `options.hooks.after` を全プラグインの after-hook より先に実行する
(`node_modules/better-auth/dist/api/dispatch.mjs` の `getHooks` で実測確認)。そのため
`src/auth.ts` の `hooks.after` に置いていた welcome メール送信と `sign_in` audit event の発火を、
自前プラグイン `src/auth-plugins/sign-in-observer.ts` へ移設し、**mfa-challenge の後に登録する**。

登録順が後であることにより、チャレンジ介入で `newSession` が null 化された状態を observer が自然に
観測してスキップする (チャレンジ未通過の時点で `sign_in` を記録しない)。順序そのものが正しさの前提に
なるため、プラグイン登録順はテストで固定する。あわせて一次認証手段 (`magic_link` / `github`) の
写像表を observer の 1 箇所に集約する。

この移設のさい、既存の `hooks.after` が `sign_in` audit を **一度も記録できていなかった**ことが判明した
(移設前の DB は `sign_in` 行が 0 件)。原因は method 写像が具体パス (`/sign-in/magic-link` /
`/callback/github`) で分岐していた点にある — hook の `ctx.path` はルートパターン (`/callback/:id`) を返し、
かつセッション生成は `/magic-link/verify` で起きるため、Magic Link・GitHub OAuth の**両分岐とも到達不能
だった**。写像をセッション生成パス (`/magic-link/verify` / `/callback/:id`) に合わせて修正し、本 ADR の
チャレンジ経路 (`/two-factor/verify-*`) を加えた。

### 4. `AUTH_SECRET` は MFA 登録済みユーザーの復号鍵を兼ねる — ローテーションは制約とする

**`AUTH_SECRET` は cookie 署名鍵であると同時に、twoFactor プラグインが TOTP secret を
`symmetricEncrypt` で暗号化する鍵、および `storeBackupCodes: "encrypted"` でリカバリーコードを
暗号化する鍵でもある。** この値を差し替えると、登録済み全ユーザーの TOTP secret とリカバリーコードが
復号不能になる。

復号不能は自力で回復しない: ログイン手段は Magic Link / GitHub OAuth のみでチャレンジは必ず通る必要が
あり、再登録 (enroll) は MFA 有効中は 409 で拒否され、無効化 (disable) は有効なコードの入力を要求する。
つまり **MFA 登録済みユーザー全員が同時に、自力復帰不能なロックアウトに陥る**。session が失効するだけの
通常の鍵差し替え (再ログインで回復する) とは影響の質が違う。

現在 `AUTH_SECRET` は taimei / taimei-auth 双方の compose に同じ dev 値が hardcoded されており
(README「cross-subdomain Cookie でのローカル動作」)、本番鍵を実際に差し替える契機は現実に存在する。
暗黙の前提にはできないため、明示的な制約として宣言する:

> **MFA 登録済みユーザーが 1 人でも存在する状態での `AUTH_SECRET` ローテーションは未対応。**

再暗号化スクリプトは本件では用意しない (旧鍵と新鍵を同時に持つ再暗号化経路を作ること自体が、鍵漏洩時に
旧鍵を保持する運用を招く)。やむを得ずローテーションが必要になった場合の手順は次のとおりで、これが
唯一の逃げ道である:

1. `management/disable-user-mfa.ts` を MFA 登録済みユーザー全員に対して実行する
   (`two_factor` 行の削除 + `twoFactorEnabled=false` + `mfa_disabled` audit event + 本人通知メール)
2. `AUTH_SECRET` を差し替えて deploy する
3. 各ユーザーに認証アプリの再登録を依頼する

再評価トリガー: MFA 登録ユーザー数がこの手順で捌けない規模になったとき。その時点で再暗号化手順を設計し、
本 ADR を更新する。

### 5. 登録・有効化の直前に再認証 (step-up) を置かない — 受容したリスク

パスワードレス構成のため twoFactor プラグインには `allowPasswordless: true` が必須で、**この設定が
プラグイン内蔵の「有効化前にパスワードを要求する」step-up を無効化する**。代替の step-up (操作直前の
Magic Link 再送など) も本件では実装しない。

したがって次のリスクを受容する: **session を奪取した攻撃者が enroll → activate を実行すると、
有効化に伴う他 session の revoke で正規ユーザーが自分のアカウントから締め出される。**

- **検知経路**: 有効化・無効化の両方で本人に通知メールを送る (勝手な有効化 = 締め出し、勝手な無効化 =
  保護解除の、いずれも本人が気づける唯一の信号)
- **復旧経路**: `management/disable-user-mfa.ts` による運用救済

不採用の理由は、防げる範囲が「session 奪取済みの攻撃者による有効化」に限られる一方で、ログイン動線が
二重になるコストが常時かかること。再評価トリガー: step-up を要する操作が他にも増えたとき
(その時は本件専用ではなく共通機構として設計する)。

### 6. SDK / consumer 表面は本件で変更しない

`packages/auth-client` / proto / `SessionData` は無変更とする (CLAUDE.md ルール 3)。

チャレンジ保留中は session の実体が破棄されているため、`createAuthGuard` を使う consumer app からは
単に「未認証」に見え、既存の未認証ハンドリングがそのまま働く。consumer 側は SDK のバージョンを上げずに
動く。`SessionData` に MFA 状態を載せないため、consumer app が MFA の有無で分岐する手段は現時点で
提供しない (必要になった時点で proto 追加 + SDK の minor で対応する)。

## Consequences

- **upstream 追随のコストを恒常的に負う**: better-auth の minor 更新で cookie 名・署名 scheme・
  verification value のキー形式が変わると、MFA 有効ユーザーがログイン不能になる。静的テスト + 統合
  テスト + 依存更新時の手順で PR 時点に検知を寄せているが、検知は「落ちる」ことであって自動修復ではない。
- **緊急停止スイッチが必要になった**: 上記の drift や想定外の障害に対し、deploy の rollback なしで
  チャレンジ強制を止められるよう `MFA_CHALLENGE_ENABLED` を持つ。fail-safe 既定 (明示的な `"false"`
  のみ off、未設定 / 空文字 / 不正値は on) とし、off で動作している間は Sentry に warning を 1 回出す
  (「止めたまま気づかない」を防ぐ)。
- **運用救済スクリプトが恒久的な運用資産になる**: `management/disable-user-mfa.ts` は、認証アプリと
  リカバリーコードを両方失ったユーザーの唯一の救済経路であり、上記 4 の鍵差し替え手順と 5 の締め出し
  復旧も同じスクリプトに依存する。削除・退避してはならない。
- **挙動変更 (`sign_in` audit event)**: 観測点の移設に伴い、これまで写像から漏れて記録されていなかった
  Magic Link ログインの `sign_in` が記録されるようになる。1 回のログインで記録される `sign_in` は
  1 件 (MFA 有効ユーザーはチャレンジ成功時点で 1 件) で、移設前後で welcome メールの送信条件と通数は
  変わらない。
- **`src/auth.ts` が設定とプラグイン登録に痩せる**: hooks の移設により ADR-0012 の 200 行閾値からも
  距離が取れる。代わりに、正しさの一部 (プラグイン登録順) がファイルの並び順という壊れやすい形で表現
  されるため、テストで固定する。
- **チャレンジ画面は二本目の認証経路になる**: `/api/mfa/challenge*` は `two_factor` cookie を認証材料と
  する経路で `requireActor` を通らない。認可スモークの対象に明示的に含め、cookie 無し / 改ざん /
  期限切れの 3 ケースを固定する。
- **有効化はコード検証より先に他セッションを revoke する**: プラグインの有効化がセッションを rotate して
  古いトークンを消すため、revoke を後に回すと rotate 前のトークンが revoke 対象から外れて生き残る。
  この順序は動かせないので、**有効化ダイアログで 6 桁コードを打ち間違えた場合でも他デバイスの
  セッションは失効する**。未登録・有効化済みの呼び出しは use-case 先頭の前提条件で弾き、「何も
  有効化しないまま全デバイスが落ちる」「audit と通知メールが 1 組増える」までは防ぐが、
  コードの打ち間違いだけは本プラグイン構成では構造的に回避できないため受容する。
- **revoke には最大 5 分の残余ウィンドウがある**: 有効化・無効化に伴う「操作セッション以外の revoke」は
  Redis 上のセッション実体を消すが、`cookieCache` (maxAge 5 分) が生きている間は他セッションが
  `requireActor` や consumer の VerifySession を通過し続ける (`two_factor_enabled` は revision
  トリガーの対象列ではないため、フラグ更新でも失効しない)。退会・事業所削除など既存の revoke 経路と
  同じ platform 挙動 (`db/CLAUDE.md` ルール 2 の例外規定) であり、ログインの hot path を変えてまで
  詰める価値は無いと判断し、既知の bound として記録するに留める。

## 検討した代替案 (不採用)

| # | 案 | 不採用理由 | 再評価トリガー |
|---|---|---|---|
| A | twoFactor プラグインを素のまま使う | 本サービスのログイン経路ではチャレンジが発火しない。要件を満たさない | upstream がチャレンジ範囲を再拡大した時 (= 本 ADR の撤退線) |
| B | MFA を全自前実装する | secret の暗号化保管・コードの単回消費・試行ロック・リカバリーコードの正しさを全て所有することになる。認証の中核ほど既製実装の方が安全 | upstream への追随コストが自前実装の維持コストを上回った時 |
| C | upstream に per-method opt-out を PR して待つ | 一度 revert された経緯があり、マージ時期を握れない。その間 MFA を出せない | — (撤退線として結果的に取り込む) |
| D | 一次認証の handler 自体を fork / patch する | better-auth の内部 route 実装を丸ごと抱えることになり、封じ込め面積が cookie 形式 3 点よりはるかに広がる | — |
| E | チャレンジ状態を自前テーブルで持つ | 内部形式への結合は切れるが、コード検証は結局プラグインの `auth.api` を通すため二重の状態管理になり、不整合の窓が増える | プラグインのチャレンジ状態を使わない構成 (全自前) に倒す時 |
| F | チャレンジの遷移先 (`redirect_url`) を URL クエリで持ち回る | ADR-0003 で塞いだオープンリダイレクトを再導入することになる。採用したのは verification value 側に保持し、返す直前に出口検証する方式 | — |
| G | リカバリーコードを hash 保管にする | TOTP secret 自体が可逆保管必須である以上、同じ鍵で守られるリカバリーコードだけを hash にしても追加防御はほぼ無い。プラグイン既定の暗号化保管を受容する | TOTP secret の保管方式そのものを変える時 |
| H | メールによる第二要素 / メール fallback | ログイン手段がメール (Magic Link) であるため、メール到達性を第二要素にするのは MFA 無効化と等価 | ログイン手段にパスワードが加わった時 |

## Scope out (後続案件)

- 事業所による MFA 強制、信頼済みデバイス (remember device)、リカバリーコードの再生成
- Passkey (`/account/security` は「実装予定」のまま)
- チャレンジ画面への **canary token** 埋込み

## 関連

- ADR-0003 (redirect_url allowlist) — チャレンジ成功時の遷移先の出口検証が依拠する規則
- ADR-0010 (削除ライフサイクル) — `two_factor.user_id` の `onDelete: cascade` の根拠
- ADR-0011 (Workers 移行) — secondaryStorage 構成でチャレンジ状態が Redis で完結する前提
- ADR-0012 (レイヤードアーキテクチャ) — プラグイン殻を `src/auth-plugins/` (Frameworks & Drivers)、
  判定と業務手続を `src/mfa/` に置く層規律
- 用語定義: [`CONTEXT.md`](../../CONTEXT.md) の「多要素認証 (MFA)」「TOTP」「MFA チャレンジ」「リカバリーコード」
</content>
</invoke>
