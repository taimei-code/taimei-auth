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
- cookie 署名 scheme — better-call 1.3.7 (`dist/crypto.mjs` の `makeSignature`) の HMAC-SHA-256 を
  **パディング付き標準 base64** で載せる形式 (`btoa` 出力。32 byte = 44 文字、末尾 `=`)。better-call の
  `getSignedCookie` は検証前に「44 文字かつ末尾 `=`」で足切りする

  再実装で取り違えやすいのが **`createHMAC("SHA-256", "base64urlnopad")`** で、これで検証すると上の
  足切りに掛かって**常に false になる**。にもかかわらず同じ better-auth の中に実在する scheme で、
  **信頼済みデバイスのトークン** (`plugins/two-factor/`) と **cookie cache** (`cookies/index.mjs`) は
  そちらを使っている — 「better-auth の署名」で一括りにできない。一方 `hono/cookie` の
  `getSignedCookie` は better-call と同一 scheme (実装も同内容) で**署名としては互換**であり、
  使っていないのは Hono の `Context` を要求して生の `Headers` を扱う本経路に載らないため

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
あり、登録の再実行 (enroll) は MFA 有効中は 409 で拒否され、無効化 (disable) は有効なコードの入力を要求する。
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
3. 各ユーザーに認証アプリの新規登録を依頼する

再評価トリガー: MFA 登録ユーザー数がこの手順で捌けない規模になったとき。その時点で再暗号化手順を設計し、
本 ADR を更新する。

### 5. 登録・有効化の直前に再認証 (step-up) を置かない — 受容したリスク

パスワードレス構成のため twoFactor プラグインには `allowPasswordless: true` が必須で、**この設定が
プラグイン内蔵の「有効化前にパスワードを要求する」step-up を無効化する**。代替の step-up (操作直前の
Magic Link 再送など) も本件では実装しない。

したがって次のリスクを受容する: **session を奪取した攻撃者が enroll → activate を実行すると、
有効化に伴う他 session の revoke で正規ユーザーが自分のアカウントから締め出される。**

- **検知経路**: 有効化・無効化の両方で本人にbest-effortの通知メールを送る (勝手な有効化 = 締め出し、
  勝手な無効化 = 保護解除)。運用調査にはaudit logを使う。process crashを跨ぐdurable deliveryは保証しない。
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

### 7. MFA 登録状態 — 5 状態マトリクス (2026-08-11 追記)

**MFA 登録状態** (用語定義: CONTEXT.md) は `user.twoFactorEnabled` フラグと `two_factor` 行の組から
一意に決まる。解釈と操作単位の前提条件判定は `src/mfa/registration/state.ts` の関数群へ
集約し、旧 `src/mfa/enrollment-state.ts` は削除した。union は
module 内部に閉じる (評決の組み立てが消費者側に散ると、後から増えた消費者が黙って別の評決を
持てるため)。**評決を変える変更は本表の更新とセットで行う。**

| 状態 (フラグ × 行) | enroll | activate | disable | 状態取得 (表示) |
|---|---|---|---|---|
| 未登録 (F × 行なし) | 受理 | 404 `not_found` | 409 `not_enabled` | 無効 |
| 登録済み未有効 (F × 未 verified) | 受理 — 同じ secret、リカバリーコード、登録識別子を再表示する。交換は明示的な登録やり直しだけが行う | 登録識別子が一致する場合に受理 | 409 `not_enabled` | 無効 |
| 有効 (T × verified) | 409 `already_enabled` | 409 `already_enabled` | 受理 | 有効 |
| 中断した無効化 (F × verified) | 409 `already_enabled` | 409 `already_enabled` | 受理 (この状態の唯一の出口) | 無効 (バッジ) だが `in_effect=true` を返し SPA は disable を出す |
| 中断した有効化 (T × 未 verified) | 409 `already_enabled` | 409 `already_enabled` | 前提条件は受理 — 正しいコードで 200 成功 (プラグインが行を verified へ修復してから削除する唯一の自己復旧口)。誤コードは 400 `invalid_code` | 有効 + Sentry error |
| 中断した有効化 (T × 行なし) | 409 `already_enabled` | 409 `already_enabled` | **前提条件で 401 `challenge_expired`** — 検証すべき secret が無く永久に成功しないため、試行枠を消費せず即拒否する (正しいコードでも枠を空費して 429 に達する事故を防ぐ)。救済は `management/disable-user-mfa.ts` | 有効 + Sentry error (窓 6h の per-user throttle) |

評決の根拠:

- enroll を「効いている」全状態で拒むのは、プラグインの enable が既存行を無条件に
  deleteMany + create し、本人の知らない secret へ黙って差し替わるため (差し替わると手元の
  認証アプリが通らなくなる = 恒久ロックアウト)
- activate の受理を「登録済み未有効」に限るのは、「中断した無効化」(verified 行あり) では
  verifyTOTP が純粋検証に縮退し、フラグ false のまま通知メールと audit だけが増える偽成功に
  なるため。「中断した有効化」で `not_found` でなく `already_enabled` を返すのはフラグ先勝ちの
  現挙動保存
- 中断 2 状態が生じるのは better-auth の 2 書き込み (フラグ / 行) が同一トランザクションに
  入らないため。順序は disable がフラグ降ろし → 行削除、activate が**フラグ立て → セッション
  rotate → 行 verified 化** (1.6.23 totp/index.mjs 実測)。activate の中断窓は書き込み 1 対では
  なく rotate の複数 I/O を挟むぶん広い。この順序を前提に「flag true ⇒ verified 行」を DB
  trigger で強制すると activate 自身のフラグ書き込みが弾かれるので不可

運用上の境界:

- `MfaStatus` (画面表示用、`src/mfa/registration/status.ts`) は本状態の射影であり別概念。表示の enabled は kind から
  導出せず `requiresMfaChallenge` (policy.ts) を通す — 表示とチャレンジ要否の判定二重化を防ぐ規律
- force-disable (`management/disable-user-mfa.ts`) は本状態判定の対象外 — Actor を持たず行削除数で
  冪等判定し、行削除 → フラグ降ろしの順序を正しさの前提にする (`user.twoFactorEnabled` の直接比較は
  policy 規律の既知の例外)
- 本表と `registration/state.ts` は kill-switch (`MFA_CHALLENGE_ENABLED`) と **直交** — kill-switch は
  ログイン境界 (src/auth-plugins/) のみに効く。登録状態の判定に混ぜると kill-switch off の
  incident 中に全ユーザーの disable が `not_enabled` になり self-service の出口が閉じる
- 表示 (enabled) とは別に `in_effect` (第二要素がまだ効いているか = isMfaInEffect) を SPA へ返す。
  「中断した無効化」は enabled=false だが in_effect=true で、SPA はこれで disable を出す (enroll は
  409 なので唯一の出口を UI から塞がない)。in_effect のため read-status は flag=false でも行を読む
  (security page は human-rate なので +1 SELECT を受容)
- フラグと行の 2 読みは単一スナップショットでないため、並行 activate / disable の最中は
  「中断した〜」が一瞬観測されうる (Sentry の false-positive として既知)。通報は user 単位・窓 6h の
  throttle (`incrementRateWindow` の count===1) で 1 エピソード 1 回に丸め、滞留再訪の event 無制限
  積み上がりを止める。行なしでは残数取得 (viewBackupCodes) を呼ばず、gateway の captureException を
  自作失敗で汚さない
- 行の一意性を DB UNIQUE で強制する (`two_factor_user_id_idx` を unique 化)。プラグインの enable は
  deleteMany + create で収束するが並行 enroll で 2 行になる窓があり、2 行状態では本表の前提
  「組から一意に決まる」が崩れるため。2 本目の create は fail-closed に落ちる。読み側
  (`findTwoFactorVerificationState`) も verified 優先の ORDER BY で決定化する
- Passkey (Scope out) を追加する時は `registration/state.ts` 内部の union を再設計する (非 export のため
  消費者は無傷)

### 8. MFA 登録遷移を user 単位で直列化する (2026-08-13 追記)

登録、有効化、無効化、運用救済は、同じ user に対する **MFA 登録遷移**として application-owned の
`mfa_registration_transition_guard` を取得する。`user_id` を主キーにし、guard 挿入と user 行と
`two_factor` 行の最新状態の再読込を同じ短い DB transaction で確定する。取得 transaction は
`lock_timeout` と `statement_timeout` を 250ms 以下に局所設定する。挿入できた request だけが
外部副作用を開始し、未 commit の insert を含む競合 request は上限内に、状態を変更せず
`503 temporarily_unavailable` に倒す。

外部 I/O を待つ間に DB transaction や session lock は保持しない。guard はランダムな operation token、
操作種別、取得時刻を持つ。成功または既知の業務失敗で、呼び出した外部 I/O の終端結果が明確な場合だけ、
user ID と token が一致する guard を CAS delete する。予期しない例外、DB 応答喪失、外部副作用の結果不明、
process crash では guard を残す。自動 TTL では解放せず、後続 writer を止めて先行 writer との交差を防ぐ。
残置の検知は解放と分離する: 取得競合時に先行 guard の `acquired_at` を観測し、正常な遷移で説明できない
滞留 (15 分超) を Sentry へ通報する。通報は検知のみで、解除は従来どおり停止確認を経た management 操作に限る。

MFA 登録遷移自体が明確な終端結果へ到達した後に guard 解放だけが失敗または結果不明になった場合は、解放失敗を
観測して guard を隔離状態として扱う一方、確定済みの遷移結果、session 変更、本人通知は失わない。解放障害を
HTTP 500 へ変換すると、rotate 済み session の cookie と不正変更を検知する通知だけが失われるためである。

運用者は先行 process の停止を確認した後、management 専用操作で guard を解除できる。解除は guard 削除と
`mfa_registration_guard_released` audit を同じ transaction で確定する。`DELETE ... RETURNING` で
1 行削除できた場合だけ audit を挿入し、同時解除または正常 CAS 解放との競合敗者は `released:false` で
audit を残さない。audit payload は実行元、理由、停止確認済みの事実だけを許可し、operation token、
登録識別子、secret、code、recovery code、session token を記録しない。

状態取得とログイン時のチャレンジ判定は guard に参加させない。ログインの hot path に DB write を加えず、
better-auth の非原子的書き込み中に一時状態を観測し得る既存契約と Sentry 検知を維持する。

**登録済み未有効**で登録を再実行した場合は secret を回転せず、暗号化保管済みの TOTP URI と
リカバリーコード、および同じ **MFA 登録識別子**を返す。最終的な有効化契約はこの識別子を必須入力とし、
guard 取得時の最新の登録と一致しなければ拒否する。これにより response 消失からは同じ登録を再開でき、
古いタブは後から作られた別の登録を有効化できない。

移行は 2 段階に分ける。第 1 段階では登録 response へ識別子を additive に追加し、新 SPA は識別子を
送る一方、旧 SPA の省略 request を旧 request 専用の application 入口で受理する。この段階では
登録やり直しを公開せず、旧タブの command と secret 交換が同時に存在する期間を作らない。ID なし
request の利用が観測されなくなった後、第 2 段階で compatibility port を削除し、識別子の必須化と
登録やり直しを同時に公開する。旧 SPA と各段階の server、新 SPA と旧 server の組合せを contract test で
固定する。

その前の phase 0 として guard migration と guard 参加を既存 wire 契約のまま全 server と management CLI へ
先行配布し、旧 fleet を完全 drain してから第 1 段階を有効化する。rollback 先も guard 参加版へ限定する。
guard 非参加版へ戻す場合は MFA write を停止し、全 process 停止と guard 残行解消を確認してから切り替える。
旧 CLI artifact は実行禁止とし、CLI は guard protocol version が一致しなければ変更を始めず終了する。

(2026-08-14 追記) 実配布では guard 参加と識別子の additive 追加を単一 changeset で配布した。本サービスの
配布単位は版の一括切替 (Workers の版切替 / compose の単一 service 再作成) で、長期の混在 fleet を持たない。
旧版 process が残る短い窓では guard が相互排他を提供しないが、その窓で交差しうるのは同一 user の並行 MFA
操作に限られ、発生時の帰結も §7 の中断状態と既存の復旧契約に収まるため受容する。rollback 先を guard 参加版に
限定する制約は維持する。

この guard が保証するのは、自前の正規 write 経路で結果不明の writer と後続 writer を交差させない
ことであり、better-auth の複数書き込みを 1 DB transaction にまとめる原子性ではない。`auth.api.*` は
別 connection で DB / Redis / session を更新するため、関連行の `FOR UPDATE` は自分が待つ書き込みを
塞ぐので使わない。途中失敗で生じる中断状態と既存の復旧契約は残す。audit は guard 解放前に呼ぶ。
guard 解放を試行した後、application service は通知を best-effort で開始する。通知失敗は観測へ回すが、
確定済み状態を巻き戻さない。操作確定後から通知投入前の process crash では通知を失い得るという
既存制約を受容し、durable delivery は別計画とする。外部メールの到着順は保証しない。

account deletion はこの guard の相互排他へ参加させない。user 削除時は既存の物理削除契約どおり
guard 行も FK cascade で削除する。削除処理と MFA 外部 I/O の競合を閉じるには account deletion 全体の
transaction 境界を再設計する必要があるため、別計画とする。

公開面は MFA 登録の directory module に集約する。self-service port は操作名を保った `getStatus` /
`enroll` / `restart` / `activate` / `disable` を提供し、権限の異なる `forceDisable` と
`forceReleaseRegistrationGuard` は management port へ
分ける。単一の `transition(command)` に異なる入力・結果を詰め込まず、handler と management CLI は
それぞれの bound façade だけを使う。`getStatus` は同じ module が状態解釈を所有するため self-service
façade に含めるが、guard は取得しない。(2026-08-21 追記) guard 非参加を構造でも表明するため、
`getStatus` は operations port (`RegistrationOperations`) から外し、façade が状態所有側
(`registration/status.ts` の `readStatus`) へ直接 bind する形にした — façade の操作名 5 つ (restart は第 2 段階まで非公開) は変わらない。

**MFA 登録やり直し**は通常の登録の再実行と分けた明示的な遷移とする。現在の **MFA 登録識別子**を必須にし、
guard 取得時の最新登録と一致する場合だけ secret、リカバリーコード、識別子を回転する。有効化または
登録やり直しで識別子が一致しない場合は `409 enrollment_changed` を返し、共通画面 SPA は現在の登録を
取り直すよう案内する。

module 内部には application-owned port と factory を置く。application core は Drizzle の
transaction 型、Redis、Sentry、email sender を参照しない。session 材料の `Headers` (WHATWG 標準型) は
不透明値として operations へ受け渡すだけで、読み取り・生成は adapter / handler 側に置く。
composition root が better-auth / transition guard /
attempt budget / audit / notification / observability adapter を結線する。本番 adapter と fault-injection 用
test adapter の 2 つで seam を正当化する一方、factory と port は handler へ公開しない。既存の統合テストは
façade 越しに残し、競合順序と部分失敗は test adapter で決定的に作る。

世代照合だけの楽観的競合制御は採らない。古いタブは拒否できても、同じ登録識別子を読んだ
enroll × activate や activate × activate が同時に better-auth を呼ぶ余地が残るためである。
反対に MFA 永続化を自前所有して 1 DB transaction へ入れる案も採らない。DB 状態の原子性と引き換えに、
secret 暗号化、リカバリーコードの単回消費、session cache 更新という認証の中核を自前所有することになり、
本 ADR が選んだハイブリッド構成の利点を失う。採用するのは永続 guard による正規経路の排他と、
結果不明時の guard 残置である。

### 9. 共通画面 SPA は MFA チャレンジの継続可否を auth ホストの結果から決める (2026-08-21 追記)

共通画面 SPA の MFA チャレンジフローは、初期観測、コード検証、必要な再照会、表示 error の決定を
共通画面 SPA 内の一つの module に集約する。画面は HTTP status や wire response を直接判別せず、
HTTP 変換 port が作る flow 向けの観測結果と検証結果だけを扱う。これにより、画面の描画状態と認証上の
MFA チャレンジを混同せず、wire contract を変更しても共通画面 SPA の flow 状態遷移を維持する。

初期の状態取得に失敗した場合は、MFA チャレンジが存在しないと推測せずコード入力を許す。
通信失敗だけでは不存在を証明できず、認証の最終判定は検証 API が担うためである。一方、検証 API が
`challenge_expired` を返した場合は継続不能として入力を閉じる。`invalid_code` の場合だけ状態を一度
再照会し、プラグインが試行上限到達時に MFA チャレンジを破棄した場合を `expired` 表示へ反映する。
再照会が失敗した場合は `invalid_code` を表示し、自動 retry と polling は行わない。

状態取得の GET は画面離脱時に中断できるが、送信済みの POST 検証は中断しない。POST 検証は auth ホスト側で
MFA チャレンジを消費し、新 session を発行して response の `Set-Cookie` で browser へ渡す。共通画面 SPA が
途中で中断すると、auth ホストでは成功したのに session cookie を受け取れない結果不明を作り得るためである。
画面離脱後は POST を完了させたまま共通画面 SPA の state への反映だけを破棄する。

検証成功時の redirect 先は、auth ホストが response を返す直前に行う出口検証を正本とする。
共通画面 SPA は allowlist を複製せず、検証済みの redirect 先へ browser 遷移を実行するだけに留める。

## Consequences

- **upstream 追随のコストを恒常的に負う**: better-auth の minor 更新で cookie 名・署名 scheme・
  verification value のキー形式が変わると、MFA 有効ユーザーがログイン不能になる。静的テスト + 統合
  テスト + 依存更新時の手順で PR 時点に検知を寄せているが、検知は「落ちる」ことであって自動修復ではない。
- **緊急停止スイッチが必要になった**: 上記の drift や想定外の障害に対し、deploy の rollback なしで
  チャレンジ強制を止められるよう `MFA_CHALLENGE_ENABLED` を持つ。fail-safe 既定 (明示的な `"false"`
  のみ off、未設定 / 空文字 / 不正値は on) とし、off で動作している間は Sentry に warning を 6 時間おきに
  出し続ける (「止めたまま気づかない」を防ぐ)。1 回きりにしないのは、通知済みフラグが isolate 常駐の
  module state になるため — warm isolate は初回以降ずっと黙り、放置が長い定常状態でちょうど信号が
  消える。逆に cold isolate が並んで同じ窓に複数出るぶんは、同一 message の Sentry 側集約に委ねる。
- **無効化の試行上限だけ fail-closed に倒す**: プラグインの試行カウントとアカウントロックは sign-in
  経路でしか動かず、セッションあり経路の `disable` には継承されない。session cookie を盗んだ攻撃者に
  よる 6 桁の総当たりを止めるのは `src/mfa/disable-attempt-budget.ts` のアカウント単位カウンタ
  (5 回 / 15 分、TTL は試行のたびに引き直すスライディング窓) だけである。計数は
  `incrementRateWindow` の MULTI (INCR + EXPIRE + TTL を 1 往復) に載せて atomic にし、
  並行リクエストで加算を取りこぼさない。軸をセッションでなくアカウントに取るのは、cookie を
  盗んだ攻撃者がセッションを取り直すたびに枠を得るのを防ぐため。汎用の `createRateLimitMiddleware` は
  availability 優先で Redis 障害時に fail-open するが、**このカウンタは数えられない時に必ず拒否する**
  — 逆に倒すと Redis を落とすだけで第二要素の総当たり防御が消えるため。代償として、Redis 障害中は
  MFA の無効化が全ユーザーで不能になる (救済は `management/disable-user-mfa.ts`)。
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
