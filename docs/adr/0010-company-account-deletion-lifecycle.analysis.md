# ADR-0010 分析: 事業所削除・アカウント削除のライフサイクル

### Tier

Tier: deep (auth/identity ドメイン + membership/user 削除セマンティクス + 6+ ファイル横断 [handlers / repositories / web / batch]。リスク領域 auth のため強制 deep)

### 検討観点

機械抽出: api_change (account-company.ts / account-membership.ts handler), db_change (membership/user repository + cascade), auth_change (アカウント削除 / OWNER 不変条件), batch_change (TTL sweep), ui_change (DangerZone 警告)
採用主軸 (5): `permission` (削除の認可: OWNER 限定 / sole-OWNER pre-check), `data_compat` (membership/account/session の cascade と orphan 不変条件), `idempotency` (削除の冪等性 / バッチ再実行), `auth_state` (orphan→account削除→session失効→ログアウト / signup 一時状態), `data_volume` (多メンバー事業所削除 / TTL sweep 大量処理)
追加副軸: `observability` (audit_log: company_deleted / membership_removed / account_delete)
ドロップ: `req_form` (削除系は body をほぼ取らず req 形式の関心が薄い → 非影響確認に既存 validation regression を 1 行残す)

---

## 受け入れ条件

### 正常系

- [ ] permission: OWNER が自社の DeleteCompany → 204、その company の membership 全削除 + company は activation_status=DELETED
- [ ] data_compat: 事業所 A・B に所属する user が B を削除 → B の membership のみ削除、A の所属と user account は無傷
- [ ] idempotency: 同一事業所への DeleteCompany を 2 回 → 2 回目も 204 冪等、membership 二重削除は 0 行 no-op
- [ ] auth_state: 唯一の事業所を sole OWNER が削除 → membership 0 件 → 当該 account を削除 → session 全失効 → レスポンスでフロントにログアウト遷移を指示
- [ ] data_volume: 50 メンバーの事業所を削除 → 50 membership 削除 + 各メンバー orphan 判定 → 1 transaction 内で完了
- [ ] observability: DeleteCompany 成功時、audit_log に company_deleted 1 件 + membership_removed を削除メンバー数ぶん記録
- [ ] data_compat [退会経路]: 複数所属 user が最後でない 1 事業所を退会 (member remove self) → その membership のみ削除、account 残存

### 異常系

- [ ] permission: 非 OWNER (ADMIN / MEMBER) が DeleteCompany → 403 forbidden、membership も company も無変更
- [ ] permission: 未認証で DeleteCompany / member remove → 401 unauthorized
- [ ] data_compat: sole OWNER が active 事業所を残したまま退会 (DeleteUser) → FailedPrecondition (既存 pre-check 維持)、user / membership 無変更
- [ ] idempotency: 存在しない companyId への DeleteCompany → 404 not_found
- [ ] auth_state: orphan 削除で deleteUser 後、同一 tx 内の後続処理が失敗 → 全 rollback (account も membership も復元、audit も残さない)
- [ ] data_volume: TTL sweep バッチが途中で 1 件 deleteUser に失敗 → その 1 件のみスキップ/記録し、残りは継続 (全体 rollback で全部止めない)
- [ ] observability: DeleteCompany の tx が失敗 → audit_log に company_deleted が残らない (audit を mutation と同一 tx に置く)

### エッジケース

- [ ] permission [境界値: 最後の OWNER 競合]: 2 セッションが同時に最後の OWNER を除名/降格 → withOwnerLockGuard で直列化、片方は 409 last_owner
- [ ] data_compat [境界値: orphan 判定の所属残存]: user が削除対象 B と存続 A に所属、B 削除直後の orphan 判定で A の membership を数えて account を保持
- [ ] idempotency [境界値: 0 行対象]: 既に除名済みメンバーへ remove → 404 not_found / 既に membership 0 件の user へ deleteAccountIfOrphaned → 二重 deleteUser しない (user 不在で no-op)
- [ ] auth_state [境界値: signup 途中]: magic link 認証直後で membership 0 件の account → 即削除されず TTL 内は許容 (登録途中の正規一時状態)
- [ ] data_volume [境界値: TTL 境界]: 作成から TTL ちょうど (24h) 前後の 0 件 account → sweep の閾値判定が境界で安定 (< と <= の取り違えなし)
- [ ] observability [境界値: 自己削除]: actor が自分の最後の事業所を削除し account 消滅 → audit_log.user_id は FK なしで残存 (account_delete / company_deleted 証跡が消えない)

### MECE追加 (Critical 由来)

- [ ] [MECE追加] data_compat: 事業所削除と同一 tx で当該 company 宛 PENDING invitation を失効 (status=REVOKED)。invitation 受諾経路で company.activation_status=DELETED の company への accept を 409/410 で弾く (BB-1: soft-deleted company への所属復活を防ぐ)
- [ ] [MECE追加] auth_state: orphan アカウント削除時、当該 user の session を user_id で全件失効/物理削除 (全デバイス)。削除後の token 検証は user 不在で拒否 (BB-3: 削除済みアカウントの認証バイパス防止)。hard delete の session cascade に依存せず明示的に revoke する
- [ ] [MECE追加] permission [境界値: 異経路競合]: 「最後の OWNER 除名 (member remove)」と「最後の事業所 DeleteCompany」の同時実行を、company 行または対象 membership の SELECT ... FOR UPDATE 行ロックで直列化し、双方の pre-check すり抜けを防ぐ (BB-11)
- [ ] [MECE追加] data_compat: company soft delete + membership 物理削除 + orphan user 削除 + session 失効 + invitation 失効を単一 transaction に置き、いずれか失敗で全 rollback (WB-12: 中間状態の永続化防止)
- [ ] [MECE追加 補足] auth_state: orphan 削除対象 user は所属 0 件のため別事業所の sole OWNER になり得ない (BB-5 は orphan-delete モデルで構造的に発生しない。確認のため非影響に regression を残す)
- [ ] [DA追加] data_compat: 削除 company を last_used_company_id に指す他事業所生存メンバーの当該列を、残存 active membership (なければ NULL) に同一 tx で再解決 (DA Critique 1: soft delete で set null FK が発火しない dangling 防止)
- [ ] [DA追加] auth_state: OWNER/ADMIN が他メンバー (他に所属なし) の最後の membership を除名 → victim の account が連動削除され、actor は「このユーザーはアカウントごと削除される」確認を経る
- [ ] [DA追加] idempotency: backfill は dry-run で対象 membership/orphan user_id を全件出力 → 確認後に小バッチ + 全 user_id ログ付きで実削除 (DA Critique 3: rollback 不能な初回物理削除の事故防止)
- [ ] [DA追加 補足] data_volume: TTL sweep は created_at < now-24h AND active membership 0件 を対象とし実行中 tx と分離 (DA Critique 2: 既存ユーザーを巻き込まない)

### 非影響確認

- [ ] [invitation 受諾] が membership cascade 変更後も insertMembership で正常に所属を作れる (orphan 判定の巻き添えで消えない)
- [ ] [SetCurrentCompany / TransferOwnership / UpdateRole] が membership ライフサイクル変更後も既存どおり動作
- [ ] [createSignupCompany (PR #74)] の新規 signup (一度も事業所を持たない account の初回作成) が引き続き成功
- [ ] [既存 body validation] DeleteCompany / member remove の既存 400 系挙動が踏襲される (実装時に実値確認) (仕様確定要)
- [ ] [session / account cascade] DeleteUser の既存 cascade (session・account・invitation) が orphan 経由削除でも同様に効く

---

## 技術リスク

1. **actor 自己削除と session 失効の整合**
   - 何がわからないか: 最後の事業所削除で actor 自身の account が同一リクエスト内で cascade 削除されたとき、フロントが使えるログアウト signal を受け取れるか不明。
   - 最悪何が起きるか: 操作者の画面が 500 や白画面のまま残り、削除は済んでいるのに UI が壊れて見える。
   - どうやって検証するか: sole OWNER が唯一事業所を削除するテストで user 行消滅 + session revoke を assert し、handler が success+logout フラグを返すことを確認する。
     ```
     bun test src/handlers/__tests__/account-company.delete.test.ts
     ```

2. **orphan 判定の所属カウント順序**
   - 何がわからないか: company 削除 tx 内で当該 membership を物理削除した後に countActiveMembershipsByUserId が「残りの所属」を正しく反映するか不明 (削除前カウントだと誤って account を消す)。
   - 最悪何が起きるか: 他事業所に所属する正規ユーザーの account を誤って削除する。
   - どうやって検証するか: A・B 所属 user で B 削除 → A の membership 1 件が残り account 保持、を assert するテスト。

3. **membership 物理削除と company_id RESTRICT の整合**
   - 何がわからないか: membership を物理削除してから company を soft delete する順で FK 制約 (company_id ON DELETE RESTRICT) に触れないか。
   - 最悪何が起きるか: 削除 tx が FK 違反で落ち、事業所削除自体が常時失敗する。
   - どうやって検証するか: 実 DB の tx で membership DELETE → company UPDATE を流し FK エラーが出ないことをテストで確認。

4. **backfill が既存 orphan を予期せず削除**
   - 何がわからないか: 既存 DELETED company の残存 membership を消すと、現在 re-onboarding に頼っている本物の account を orphan 削除してしまう範囲が不明。
   - 最悪何が起きるか: 本番で意図せず実ユーザー account を削除する。
   - どうやって検証するか: backfill を dry-run モードで先に対象件数と user_id を出力し、削除前に件数確認する。

5. **TTL sweep と signup 途中の競合**
   - 何がわからないか: 作成から 24h 境界の user が初回事業所を作成中に sweep に消されないか。
   - 最悪何が起きるか: 登録完了直前のユーザー account をバッチが削除する。
   - どうやって検証するか: membership 0 件 AND created_at < now-24h の条件のみを対象にし、境界テスト (24h 直前/直後) を書く。

---

## MECE 分析結果

判定: **要修正 (Critical 4件)** → AC-26〜29 ([MECE追加]) として塞ぎ込み済み。

| 観点 | 件数 |
|---|---|
| AC カバレッジ | 25 基本 + 5 MECE追加 = 30 (うち [MECE追加] 5) |
| Critical | 4 (BB-1 / BB-3 / BB-11 / WB-12) → AC 追加で対処 |
| Important | 6 (BB-4 警告UX / BB-5 連鎖OWNER / BB-13 並行操作 / WB-3,6,9 orphan判定実装 — D2 実装で塞ぐ) |
| Nice / 整理 | BB-7 冪等 status (204/404 で確定) / BB-10 signup判別 / 重複 AC-2≈AC-16 (片方は account 保持判定に focus) |
| 判定不能 | 0 |

### Critical の塞ぎ方 (実装必須コンポーネント)

1. **単一 tx (WB-12)**: company soft delete + membership 物理削除 + orphan user 削除 + session 失効 + invitation 失効を 1 transaction。
2. **session 全失効 (BB-3)**: orphan 削除で `revokeAllSessionsForUser` を明示的に呼ぶ (hard delete の cascade に依存しない)。
3. **invitation 失効 (BB-1)**: 事業所削除時に当該 company の PENDING invitation を REVOKED 化 + 受諾経路で DELETED company を弾く。
4. **行ロック直列化 (BB-11)**: DeleteCompany と member remove の異経路を `withOwnerLockGuard` 相当 / company 行 FOR UPDATE で直列化。

### Important の方針

- BB-4 (警告 UX) → PR-2 で対応 (ADR D3)。
- BB-5 (連鎖 OWNER) → orphan-delete モデルでは対象 user が所属 0 件のため別事業所 OWNER になり得ず構造的に発生しない。非影響 regression で確認。
- WB-3/6/9 → D2 の orphan 判定実装そのもの (PR-1 の主目的)。

### 冪等 status の確定 (BB-7)

DeleteCompany 冪等返却を **204 (既削除含む成功)**、存在しない companyId は **404 (現状 403 だが要確認)** に定義。実装時に既存挙動を実値確認。
