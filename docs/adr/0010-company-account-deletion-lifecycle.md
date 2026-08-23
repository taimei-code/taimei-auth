# ADR-0010: 事業所削除・アカウント削除のライフサイクルと orphan 不変条件

## Context

事業所 (company) とアカウント (user) の削除系ユースケースが、3 経路でばらばらの membership ライフサイクルを持ち、整合が取れていない。

| 操作 | 実装 | membership | 出典 |
|---|---|---|---|
| 事業所削除 | soft delete (`activation_status=DELETED`) | 残す (`company_id` は `ON DELETE RESTRICT`) | `src/handlers/account-company.ts:166`, `db/schema.ts:146-170` |
| メンバー除名 / 退会 | membership を物理 DELETE | その 1 行を消す | `src/handlers/account-membership.ts:127-177` |
| アカウント削除 (退会) | user を物理 DELETE (cascade) | `user_id` cascade で全消去 | `src/rpc/user-handler.ts:52-77`, `db/schema.ts:152` |

この非対称から、**所属 0 件のまま生存するアカウント (orphan)** が複数経路で発生し、しかも cleanup が存在しない (grep で確認: `deleteUser` は明示退会からしか呼ばれず、membership 0 件起因の自動削除は無い)。PR #74 の signup ループ (`createSignupCompany` の 0 件ガードが削除済 company の残存 membership を数えて 409 → `/account` ⇄ `/auth/signup/company` 往復) は、この orphan を「正規状態」として扱おうとして壊れた事例だった。

**ビジネス要件**: 登録ワークフローに事業所登録が含まれる以上、*どの事業所にも所属しないアカウントは存在してはならない*。orphan はサポート対象ではなく、不正状態として排除する。

### 参照アーキテクチャ (freee アカウント基盤)

同等の要件を持つ freee の IAM (nest-auth) は、orphan を「所属 0 件になった瞬間にアカウントを削除する」方式で解いていた。事業所削除を起点に、巻き込まれた各ユーザーの所属を外し、所属が 0 件になったユーザーだけアカウントを削除する (`deleteOrphanedUser`: 全 membership を数え、0 件のときだけ account 削除)。事業所自体は論理削除、最後の事業所を阻むガードは無い。本 ADR はこの「orphan→削除」モデルを taimei-auth に採る。

## Decision

### 不変条件 (SSOT)

> 完了済みアカウントは常に active membership ≥ 1 を持つ。membership が 0 件になった瞬間にアカウントを削除する。唯一許容する 0 件状態は signup の登録途中 (magic link 認証済・まだ一度も事業所を作っていない) のみで、これも恒久化させない。

「所属している = membership 行が存在する」を唯一の判定点にする。active か否かを `activation_status` の filter に依存させない (掛け忘れで壊れるため。PR #74 がその実例)。

### D1. 事業所削除は membership を物理削除する

`DeleteCompany` は対象 company の membership を tx 内で全て物理 DELETE する。company 行は監査用に soft delete (`activation_status=DELETED`) のまま残す。これにより「membership 行が存在する ⇒ その company は ACTIVE」が常に成り立ち、ghost membership 階級のバグが構造的に消える。

### D2. orphan は即削除 (共有プリミティブ化)

membership が減る全経路の直後に、所属 0 件になったユーザーのアカウントを削除する。

```
deleteAccountIfOrphaned(userId, tx):
  active membership を数える → 0 件なら deleteUser(userId, tx)
  (session / account / membership は schema の cascade で連動削除)
```

適用点:
- **事業所削除 (D1)**: OWNER 認可 → audit → 全 membership 物理削除 → 各元メンバーに `deleteAccountIfOrphaned` → company を soft delete。
- **退会 / 除名**: `deleteMembership` 直後に対象ユーザーへ `deleteAccountIfOrphaned`。

### D3. 「最後の事業所削除」はアカウントも連動削除する

唯一の事業所を OWNER が削除した場合、その OWNER は membership 0 件 = orphan になりアカウントごと削除される (= 実質退会)。削除実行前に UI で「この操作でアカウントも閉じます」と明示警告し、削除後はログアウト状態へ遷移させる。actor が自分自身を削除するケースを handler で扱う (フロントへログアウト誘導の signal を返す)。

### D4. アカウント削除 (退会) は物理削除のまま据え置く

`DeleteUser` は現状の物理削除 (cascade) を維持する。`audit_log` が `user_id` に FK を持たない設計 (`db/schema.ts:125-140`) なので account_delete の証跡は残る。論理削除 + PII 消去への移行はコンプラ要件が出た時点で別 ADR とする。sole-OWNER pre-check (`findCompaniesBlockingUserDeletion`) と OWNER≥1 不変条件 (`withOwnerLockGuard`) は維持する。

### D5. 登録途中放棄は TTL sweep バッチで回収する

signup の一時的な 0 件アカウントは許容するが恒久化させない。membership 0 件かつ作成から一定時間 (初期値 24h) 経過したアカウントを定期ジョブで削除する。

### D6. 削除処理は同期 transaction のまま行う

1 事業所あたりの関連データ量が小さい現状では、freee のような非同期 Job 化はしない。将来 company 配下のデータが大量化したら Job 化を再検討する (前提を本 ADR に明記)。

## Why

- **不変条件を行存在に寄せる理由**: PR #74 は「active を status filter で判定する」設計が 1 箇所の掛け忘れで壊れる脆さを実証した。membership 行の存在自体を真実にすれば、判定点が FK と row count に集約され、掛け忘れが起きない。D1 はこの不変条件を物理的に保証する手段。
- **orphan を削除する理由 (再 onboarding しない)**: 所属 0 件アカウントはビジネス要件上あってはならない状態。これを「signup へ送り直す正規状態」として扱うと PR #74 の往復ループのような不整合を恒常的に抱える。freee (nest-auth) も同要件を orphan→削除で解いており、参照実装がある。
- **最後の事業所削除を連動削除にする理由**: orphan を作らない invariant 下では、最後の事業所削除は必然的にアカウント削除を伴う。ブロックして明示退会へ誘導する案より 1 操作で完結し導線が単純。事故防止は削除前の明示警告で担保する。
- **退会を物理削除のまま据え置く理由**: 現状で監査要件 (audit_log 残存) は満たせており、論理削除化は大改修。要件が顕在化していない段階で先行投資しない。

## Consequences

- **挙動変更**: 「最後の事業所を削除するとアカウントが消える」。UI 警告とログアウト遷移が必須。
- **PR #74 の位置づけ変更**: `createSignupCompany` の active-filter ガードは、本 ADR 後は「新規 signup (一度も事業所を持たないアカウントが最初の 1 件を作る)」専用の安全弁になる。既存 orphan の再 onboarding 経路 (全削除 → `/auth/signup/company` に滞留) は D1+D2 により発生しなくなる。filter 自体は二重の安全弁として残す。
- **データ移行 (backfill) が必要**: 既に `DELETED` な company にぶら下がる残存 membership を一度物理削除し、その結果 orphan になったアカウントを回収する one-shot 処理を `drizzle/manual/` ではなく管理スクリプト (`management/`) として用意する。
- **新規バッチ基盤**: D5 の TTL sweep ジョブの定期実行 (cron / scheduler) を追加する。
- **マイグレーション不要部分**: D1 自体は tx 内 DELETE のみでスキーマ変更なし。`membership.company_id` の `ON DELETE RESTRICT` は「company を物理削除しない」現状方針と矛盾しないため維持。
- **race / 冪等性**: 事業所削除の 2 度押しは `softDeleteCompany` の `WHERE activation_status='ACTIVE'` で冪等。membership 物理削除も対象 0 行なら no-op。

## Did not adopt

### orphan を正規状態としてサポートする (旧 D2 案)

所属 0 件アカウントを再 onboarding 導線で生かす案。ビジネス要件「事業所未所属アカウントは存在してはならない」に反するため不採用。

### アカウント削除を論理削除 + PII 消去に変更する (freee D3 相当)

`user.activation_status` を足して論理削除化する案。監査要件が現状 audit_log で足りており、マイグレーション + 全 user クエリの active filter 化のコストに見合わないため見送り。要件顕在化時に別 ADR。

### active-filter を SSOT ヘルパに集約するだけで D1 を入れない

`findActiveMembershipsByUserId` を新設し全判定点を通す案。membership 行は残るので「掛け忘れ」リスクが残り、PR #74 と同階級のバグを再発しうる。行存在を真実にする D1 の方が強い。

## Implementation plan

1. **PR-1 (core: D1 + D2)**
   - repository: `removeMembershipsOfCompany(companyId, tx)`, `countActiveMembershipsByUserId(userId, tx)`, `deleteAccountIfOrphaned(userId, tx)` を `db/repositories/membership.ts` / `user.ts` に追加。
   - `account-company.ts` の `DeleteCompany`: membership 物理削除 → 各元メンバー orphan 削除 → company soft delete。actor 自己削除時のレスポンス signal。
   - `account-membership.ts` の除名/退会: `deleteMembership` 直後に `deleteAccountIfOrphaned`。
   - テスト: 唯一事業所削除→アカウント消滅 / 複数所属の 1 件削除→他は無傷 / 2 度押し冪等 / 事業所削除→退会で dangling なし。
2. **PR-2 (UX: D3)**: web の DangerZone / CompanySettings に「最後の事業所削除はアカウントを閉じる」警告とログアウト遷移。
3. **PR-3 (backfill)**: 既存 DELETED company の残存 membership 物理削除 + orphan 回収。**rollback 不能な物理削除を初回適用するため 2 段階**にする: ① dry-run で対象 membership / orphan user_id を全件出力し件数確認 → ② 確認後に小バッチ + 全 user_id ログ付きで実削除。可能なら orphan を即物理削除せず短い grace を置く。
4. **PR-4 (D5)**: 0 件アカウントの TTL sweep ジョブと定期実行設定。D2 (即時 orphan 削除) 下で永続 0 件状態は signup 登録途中のみのため対象は新規 signup の放棄分。sweep は `created_at < now-24h` AND active membership 0 件を対象とし、**実行中リクエストの tx と分離**する (既存ユーザーは D2 により 0 件で滞留しないが、安全側に対象判定を tx 分離で行い mid-flight を巻き込まない)。

### レビューで確定した追加の設計判断

- **actor ≠ victim の orphan 削除**: OWNER/ADMIN が他メンバーの最後の membership を除名すると、その victim は orphan 不変条件によりアカウント連動削除される。victim 本人は操作者でないため D3 の事前警告を受けられない。invariant 上この削除は必須とし、**actor 側に「このユーザーは他に所属が無く、除名でアカウントごと削除される」旨の確認**を出す (PR-2 で actor 向け確認に含める)。victim への事前通知は不可 (= 仕様として受容)。
- **SDK companyId の 3 値問題**: SDK は companyId を「未選択 (undefined) か有効な所属」の二値で扱うため、削除済 company を指す第三状態を作ってはならない。上記 single-tx ステップ 3 の `last_used_company_id` 再解決で「companyId は live な所属を指す」契約を維持する。

## 設計レビュー反映 (placement / tx / session)

`/review-design` の 4 reviewer + DA を経て確定した実装制約。

### レイヤ配置

- handler (薄): RBAC + zod + `requireActor` / `requireMembership` guard + `runInTransaction` 起動 + エラー→status 変換のみ。
- use-case (厚): `src/company/delete.ts` の DeleteCompany orchestration、`src/account/orphan.ts` の `deleteAccountIfOrphaned(userId, tx)` (orphan 判定 = ドメインルールなので use-case 層)。
- repository (純クエリ): `countActiveMembershipsByUserId` / `removeMembershipsOfCompany` を新設。session 失効は既存 `revokeAllSessionsForUser`、user 削除は既存 `deleteUser`、company は既存 `softDeleteCompany` を再利用。`deleteMembership` のような「判定 + 削除」複合を repository に置かない。

### 単一 transaction の順序 (FK / RESTRICT 整合)

DeleteCompany は 1 つの `runInTransaction` 内で以下の順:
1. 当該 company の PENDING invitation を REVOKED 化
2. company の membership を物理削除 (`removeMembershipsOfCompany`)
3. **削除 company を `last_used_company_id` に指している全 user の当該列を、その user の残存 active membership のいずれか (なければ NULL) に再解決** (company は soft delete = UPDATE なので `last_used_company_id` の `set null` FK が発火せず、SDK が `defaultCompanyId` で削除済 company を握る dangling 参照になるのを防ぐ)
4. 元メンバー (重複排除) ごとに `deleteAccountIfOrphaned` → 残 active membership 0 件なら `revokeAllSessionsForUser` + `deleteUser`
5. company を soft delete (`activation_status=DELETED`, `deletedAt`)
6. audit (`company_deleted` + `membership_removed`)

`membership.company_id` の `ON DELETE RESTRICT` は **company 行の物理 DELETE** のみを阻む制約。本フローは company を UPDATE (soft delete) するだけで物理削除しないため FK 違反は起きない。membership は先に物理削除されるので順序上も安全。audit は同一 tx 内なら順序非依存 (rollback で道連れ) だが、既存 `deleteUser` の慣習に合わせ mutation 前後どちらでも tx 内に置く。

### session 失効の cookieCache stale 窓を受容する

orphan 削除は本人不在の経路 (DeleteCompany / member remove / batch) で起きるため `auth.api.signOut({headers})` を呼べない。`revokeAllSessionsForUser` (DB `revoked_at`) + `deleteUser` の cascade で失効するが、better-auth の Redis secondaryStorage cookieCache (`src/auth.ts` `maxAge: 5*60`) は即時無効化されず**最大 5 分 stale session が valid に見える**。これは既存の退会 (`deleteUser` handler) が既に抱える同根の制約で、orphan 削除も同経路を踏襲し**同じ 5 分窓を受容する** (詳細: `db/CLAUDE.md` ルール 2 例外)。tx 内には DB 操作のみを置き、`auth.api.*` (HTTP/Redis IO) を tx 内で呼ばない。

### 既存 soft-delete セマンティクスとの統合

既存 `account-company.ts` の「membership / invitation は残す」コメント (ADR-009 由来) は本 ADR で**更新する** (membership は物理削除、invitation は REVOKED 化)。company 行のみ soft delete を維持する点は不変。

### `/db/` 分離計画との整合 (transition note)

将来 `/db/` を別プロセスに剥がすと、本 ADR の「単一 tx で 5 操作」は分散 tx 不可のため成立しない。その時は `/db/` 側に DeleteCompany 一括 RPC を新設し tx を `/db/` 内に閉じる設計へ転換する (現状の単一プロセスでは単一 tx で正)。

## 実装準備

### ブランチ戦略

各 PR を `main` 起点の独立ブランチで切る (PR 間は論理依存のみで物理 rebase 連鎖はしない)。命名: `feat/company-deletion-*` / `chore/*`。

### PR 分割計画 (≤5 files・≤2 commits/PR)

| PR | スコープ | 主ファイル | 依存 |
|----|----------|-----------|------|
| PR-1 | repository primitive + orphan use-case: `countActiveMembershipsByUserId` / `removeMembershipsOfCompany` / `reassignLastUsedCompany` / invitation 一括 REVOKED / `deleteAccountIfOrphaned`(src/account/orphan.ts) + 単体テスト | db/repositories/membership.ts, db/repositories/invitation.ts, db/repositories/user.ts, src/account/orphan.ts, db/__tests__ | - |
| PR-2 | DeleteCompany use-case(src/company/delete.ts, 単一 tx orchestration) + handler 配線 + member remove の orphan cleanup + 統合テスト + 既存コメント更新 | src/company/delete.ts, src/handlers/account-company.ts, src/handlers/account-membership.ts, src/company/__tests__ | PR-1 |
| PR-3 | UX(D3): web DangerZone/CompanySettings の「最後の事業所削除=アカウント削除」警告 + actor≠victim 確認 + ログアウト遷移 | web/src/account/DangerZone.tsx, web/src/company/pages/CompanySettings.tsx, web/src/company/company-api.ts | PR-2 |
| PR-4 | backfill 管理スクリプト(2 段階: dry-run → batched 実削除 + 全 user_id ログ) | management/backfill-orphan-cleanup.ts | PR-2 |
| PR-5 | TTL sweep バッチ(0 件 AND created_at<now-24h)+ 定期実行設定 | src/jobs/orphan-sweep.ts, db/repositories/user.ts | PR-2 |

### 手動 QA 手順 (Chrome DevTools MCP)

**環境**: http://auth.taimei-code.local:3100 (QA 実行時に確認)

- QA-H-04 (最後の事業所削除→アカウント連動削除→ログアウト): sole OWNER で唯一事業所を削除 → `/auth` 等の未ログイン画面へ遷移し、再アクセスでセッション無効を確認。
- QA-M(D3 警告): CompanySettings/DangerZone で最後の事業所削除時に「アカウントも閉じる」警告が出ること、複数所属時は警告が出ないこと。
- QA-M(actor≠victim): OWNER が他に所属の無いメンバーを除名する画面で「このユーザーはアカウントごと削除される」確認が出ること。
- QA-H-02 / QA-D-02 (他事業所無傷): 複数所属ユーザーの 1 事業所を削除後、残事業所が `/account` で正常表示され `current company` が dangling しない (last_used_company_id 再解決の目視確認)。

UI を伴わない backend 挙動 (tx/cascade/FK/audit/冪等/orphan/last_used 再解決/invitation 失効) は自動 QA で担保。

### 自動 QA (bun test 仕様)

- **対象 AC**: 34項目 (正常系7 / 異常系7 / エッジケース6 / 非影響5 / MECE追加5 / DA追加4)。
- QA-H-01,03,05,06,07 / QA-E-* / QA-D-01..03,06 / QA-R-* / QA-M-* / QA-DA-*: `src/company/__tests__/delete.test.ts` と `src/account/__tests__/orphan.test.ts`、`db/__tests__/membership.test.ts` に実 DB テストとして実装。
  - 唯一事業所削除→user/session/membership 消滅・company DELETED (QA-H-04 の backend 部)
  - 複数所属の 1 事業所削除→当該 membership のみ・他所属と account 無傷 (QA-H-02/QA-D-02)
  - 2 回削除の冪等 (QA-H-03)・存在しない companyId→404 (QA-E-04)
  - orphan 削除後の後続失敗→全 rollback (QA-E-05)
  - last_used_company_id 再解決 (QA-M last_used)・PENDING invitation REVOKED + DELETED company への accept 拒否 (QA-M invitation)
  - 異経路競合の行ロック直列化 (QA-M row-lock)・単一 tx 全 rollback (QA-M single-tx)
  - TTL sweep の 24h 境界 (QA-D-05) と既存ユーザー非巻き込み (QA-DA TTL)
- QA-R-* (非影響): createSignupCompany / SetCurrentCompany / TransferOwnership / UpdateRole / invitation 受諾の既存テストが緑のままを確認。

## References

- PR #74: signup ループ修正 (active-filter)。本 ADR の発端。
- 参照実装: freee アカウント基盤 nest-auth の orphan→アカウント削除 (`deleteOrphanedUser`)、CFO-Alpha の `destroy_with_users` / `deletable?` (最後の事業所ガード無し)。
- 関連: `db/schema.ts` (membership FK), `src/company/create.ts` (createSignupCompany 0 件ガード)。

---

## 品質検証

- AC: 5観点×必須3カテゴリ + observability + 非影響確認 5件 = 25項目定義済み → 0010-company-account-deletion-lifecycle.analysis.md
- 技術リスク: 5件特定済み → 0010-company-account-deletion-lifecycle.analysis.md
- MECE判定: 要修正（Critical 4件）→ AC-26〜29で塞ぎ込み済 / ACカバレッジ 30/30 (うち[MECE追加] 5件) / 漏れ 4件→対処済 / 重複 1件 → 0010-company-account-deletion-lifecycle.analysis.md
