# ADR-0010 分析: 事業所削除・アカウント削除のライフサイクル

### Tier

Tier: deep (auth / identity ドメインであり、membership と user の削除セマンティクスを扱い、handlers / repositories / web / batch の 6 ファイル以上にまたがる。リスク領域が auth のため deep を必須とする)

### 検討観点

機械抽出: api_change (account-company.ts / account-membership.ts の handler)、db_change (membership / user の repository と cascade)、auth_change (アカウント削除 / OWNER 不変条件)、batch_change (TTL sweep)、ui_change (DangerZone の警告)
採用した主軸 (5): `permission` (削除の認可。OWNER 限定と sole-OWNER の事前チェック)、`data_compat` (membership / account / session の cascade と orphan 不変条件)、`idempotency` (削除の冪等性とバッチの再実行)、`auth_state` (orphan からアカウント削除、session 失効、ログアウトへの流れと、signup の一時状態)、`data_volume` (多メンバー事業所の削除と TTL sweep の大量処理)
追加した副軸: `observability` (audit_log の company_deleted / membership_removed / account_delete)
落とした観点: `req_form` (削除系は body をほとんど取らず、リクエスト形式への関心が薄い。非影響確認に既存の validation regression を 1 行残す)

---

## 受け入れ条件

### 正常系

- [ ] permission: OWNER が自社に DeleteCompany を行うと 204 が返り、その company の membership が全削除され、company は activation_status=DELETED になる
- [ ] data_compat: 事業所 A と B に所属する user が B を削除すると、B の membership だけが削除され、A の所属と user account は無傷である
- [ ] idempotency: 同一事業所への DeleteCompany を 2 回行うと 2 回目も 204 で冪等であり、membership の二重削除は 0 行の no-op になる
- [ ] auth_state: 唯一の事業所を sole OWNER が削除すると membership が 0 件になり、そのアカウントが削除され、session が全失効し、レスポンスでフロントにログアウト遷移を指示する
- [ ] data_volume: 50 メンバーの事業所を削除すると、50 件の membership 削除と各メンバーの orphan 判定が 1 transaction 内で完了する
- [ ] observability: DeleteCompany 成功時、audit_log に company_deleted を 1 件と、membership_removed を削除したメンバー数ぶん記録する
- [ ] data_compat [退会経路]: 複数所属の user が最後ではない 1 事業所を退会 (member remove self) すると、その membership だけが削除され、account は残る

### 異常系

- [ ] permission: 非 OWNER (ADMIN / MEMBER) が DeleteCompany を行うと 403 forbidden になり、membership も company も変更されない
- [ ] permission: 未認証で DeleteCompany / member remove を行うと 401 unauthorized になる
- [ ] data_compat: sole OWNER が active な事業所を残したまま退会 (DeleteUser) すると FailedPrecondition になり (既存の事前チェックを維持)、user / membership は変更されない
- [ ] idempotency: 存在しない companyId への DeleteCompany は 404 not_found になる
- [ ] auth_state: orphan 削除で deleteUser した後、同一 tx 内の後続処理が失敗すると全 rollback される (account も membership も復元され、audit も残らない)
- [ ] data_volume: TTL sweep バッチが途中で 1 件の deleteUser に失敗すると、その 1 件だけをスキップして記録し、残りは継続する (全体 rollback で全部を止めない)
- [ ] observability: DeleteCompany の tx が失敗すると audit_log に company_deleted が残らない (audit を mutation と同一 tx に置く)

### エッジケース

- [ ] permission [境界値: 最後の OWNER の競合]: 2 セッションが同時に最後の OWNER を除名 / 降格すると、withOwnerLockGuard で直列化され、片方は 409 last_owner になる
- [ ] data_compat [境界値: orphan 判定での所属残存]: user が削除対象の B と存続する A に所属している時、B 削除直後の orphan 判定で A の membership を数えて account を保持する
- [ ] idempotency [境界値: 対象 0 行]: 既に除名済みのメンバーへの remove は 404 not_found になる。既に membership 0 件の user への deleteAccountIfOrphaned は deleteUser を二重に呼ばない (user 不在で no-op)
- [ ] auth_state [境界値: signup 途中]: magic link 認証直後で membership 0 件の account は即削除されず、TTL 内は許容される (登録途中の正規の一時状態)
- [ ] data_volume [境界値: TTL 境界]: 作成から TTL ちょうど (24h) の前後にある 0 件 account に対して、sweep の閾値判定が境界で安定している (< と <= の取り違えが無い)
- [ ] observability [境界値: 自己削除]: actor が自分の最後の事業所を削除して account が消滅しても、audit_log.user_id は FK が無いため残る (account_delete / company_deleted の証跡が消えない)

### MECE追加 (Critical 由来)

- [ ] [MECE追加] data_compat: 事業所削除と同一 tx で、その company 宛の PENDING invitation を失効 (status=REVOKED) させる。invitation の受諾経路では、company.activation_status=DELETED の company への accept を 409 / 410 で弾く (BB-1: soft delete された company への所属復活を防ぐ)
- [ ] [MECE追加] auth_state: orphan アカウントの削除時、その user の session を user_id で全件失効または物理削除する (全デバイス)。削除後の token 検証は user 不在で拒否する (BB-3: 削除済みアカウントの認証バイパス防止)。hard delete の session cascade に依存せず、明示的に revoke する
- [ ] [MECE追加] permission [境界値: 異なる経路の競合]: 「最後の OWNER の除名 (member remove)」と「最後の事業所の DeleteCompany」の同時実行を、company 行または対象 membership の SELECT ... FOR UPDATE 行ロックで直列化し、双方の事前チェックのすり抜けを防ぐ (BB-11)
- [ ] [MECE追加] data_compat: company の soft delete、membership の物理削除、orphan user の削除、session 失効、invitation 失効を単一 transaction に置き、いずれかが失敗したら全 rollback する (WB-12: 中間状態の永続化防止)
- [ ] [MECE追加 補足] auth_state: orphan 削除の対象 user は所属 0 件のため、別事業所の sole OWNER にはなり得ない (BB-5 は orphan-delete モデルでは構造的に発生しない。確認のため非影響に regression を残す)
- [ ] [DA追加] data_compat: 削除する company を last_used_company_id で指している他事業所の生存メンバーについて、その列を残存する active membership (なければ NULL) に同一 tx で再解決する (DA Critique 1: soft delete では set null の FK が発火しないため、dangling を防ぐ)
- [ ] [DA追加] auth_state: OWNER / ADMIN が他に所属の無いメンバーの最後の membership を除名すると、victim の account が連動して削除される。actor は「このユーザーはアカウントごと削除される」という確認を経る
- [ ] [DA追加] idempotency: backfill は dry-run で対象の membership / orphan user_id を全件出力し、確認後に小バッチと全 user_id のログ付きで実削除する (DA Critique 3: rollback できない初回の物理削除の事故防止)
- [ ] [DA追加 補足] data_volume: TTL sweep は created_at < now-24h かつ active membership 0 件を対象とし、実行中の tx とは分離する (DA Critique 2: 既存ユーザーを巻き込まない)

### 非影響確認

- [ ] [invitation 受諾] が membership の cascade 変更後も insertMembership で正常に所属を作れる (orphan 判定の巻き添えで消えない)
- [ ] [SetCurrentCompany / TransferOwnership / UpdateRole] が membership のライフサイクル変更後も既存どおり動作する
- [ ] [createSignupCompany (PR #74)] の新規 signup (一度も事業所を持たない account の初回作成) が引き続き成功する
- [ ] [既存の body validation] DeleteCompany / member remove の既存の 400 系挙動が踏襲される (実装時に実値を確認する) (仕様確定要)
- [ ] [session / account の cascade] DeleteUser の既存の cascade (session・account・invitation) が orphan 経由の削除でも同様に働く

---

## 技術リスク

1. **actor 自己削除と session 失効の整合**
   - 何がわからないか: 最後の事業所削除で actor 自身の account が同一リクエスト内で cascade 削除された時、フロントが使えるログアウトの signal を受け取れるかが不明である。
   - 最悪何が起きるか: 操作者の画面が 500 や白画面のまま残り、削除は済んでいるのに UI が壊れて見える。
   - どうやって検証するか: sole OWNER が唯一の事業所を削除するテストで user 行の消滅と session revoke を assert し、handler が success と logout フラグを返すことを確認する。
     ```
     bun test src/handlers/__tests__/account-company.delete.test.ts
     ```

2. **orphan 判定の所属カウント順序**
   - 何がわからないか: company 削除の tx 内でその membership を物理削除した後に、countActiveMembershipsByUserId が「残りの所属」を正しく反映するかが不明である (削除前にカウントすると誤って account を消す)。
   - 最悪何が起きるか: 他事業所に所属する正規ユーザーの account を誤って削除する。
   - どうやって検証するか: A と B に所属する user で B を削除し、A の membership 1 件が残り account が保持されることを assert するテストを書く。

3. **membership の物理削除と company_id RESTRICT の整合**
   - 何がわからないか: membership を物理削除してから company を soft delete する順序で、FK 制約 (company_id ON DELETE RESTRICT) に触れないか。
   - 最悪何が起きるか: 削除 tx が FK 違反で落ち、事業所削除自体が常に失敗する。
   - どうやって検証するか: 実 DB の tx で membership DELETE と company UPDATE を流し、FK エラーが出ないことをテストで確認する。

4. **backfill が既存の orphan を予期せず削除する**
   - 何がわからないか: 既存の DELETED company の残存 membership を消すと、現在 re-onboarding に頼っている本物の account をどの範囲で orphan 削除してしまうかが不明である。
   - 最悪何が起きるか: 本番で意図せず実ユーザーの account を削除する。
   - どうやって検証するか: backfill を dry-run モードで先に実行して対象件数と user_id を出力し、削除前に件数を確認する。

5. **TTL sweep と signup 途中の競合**
   - 何がわからないか: 作成から 24h の境界にある user が初回の事業所を作成している途中で sweep に消されないか。
   - 最悪何が起きるか: 登録完了の直前にあるユーザーの account をバッチが削除する。
   - どうやって検証するか: membership 0 件 AND created_at < now-24h の条件だけを対象にし、境界テスト (24h の直前 / 直後) を書く。

---

## MECE 分析結果

判定: **要修正 (Critical 4 件)**。AC-26〜29 ([MECE追加]) として対処済み。

| 観点 | 件数 |
|---|---|
| AC カバレッジ | 25 基本 + 5 MECE追加 = 30 (うち [MECE追加] 5) |
| Critical | 4 (BB-1 / BB-3 / BB-11 / WB-12)。AC 追加で対処 |
| Important | 6 (BB-4 警告 UX / BB-5 連鎖 OWNER / BB-13 並行操作 / WB-3,6,9 orphan 判定の実装。D2 の実装で対処) |
| Nice / 整理 | BB-7 冪等 status (204 / 404 で確定) / BB-10 signup 判別 / 重複 AC-2≈AC-16 (片方は account 保持の判定に焦点を置く) |
| 判定不能 | 0 |

### Critical への対処 (実装必須コンポーネント)

1. **単一 tx (WB-12)**: company の soft delete、membership の物理削除、orphan user の削除、session 失効、invitation 失効を 1 transaction にする。
2. **session 全失効 (BB-3)**: orphan 削除で `revokeAllSessionsForUser` を明示的に呼ぶ (hard delete の cascade に依存しない)。
3. **invitation 失効 (BB-1)**: 事業所削除時にその company の PENDING invitation を REVOKED にし、受諾経路で DELETED company を弾く。
4. **行ロックによる直列化 (BB-11)**: DeleteCompany と member remove の異なる経路を、`withOwnerLockGuard` 相当または company 行の FOR UPDATE で直列化する。

### Important の方針

- BB-4 (警告 UX) は PR-2 で対応する (ADR の D3)。
- BB-5 (連鎖 OWNER) は、orphan-delete モデルでは対象 user が所属 0 件のため別事業所の OWNER になり得ず、構造的に発生しない。非影響の regression で確認する。
- WB-3 / 6 / 9 は D2 の orphan 判定の実装そのものである (PR-1 の主目的)。

### 冪等 status の確定 (BB-7)

DeleteCompany の冪等な返却を **204 (既削除を含む成功)**、存在しない companyId は **404 (現状は 403 だが要確認)** と定義する。実装時に既存の挙動を実値で確認する。
