# ADR-0010: 事業所削除・アカウント削除のライフサイクルと orphan 不変条件

## Context

事業所 (company) とアカウント (user) の削除系ユースケースが、3 つの経路でばらばらの membership ライフサイクルを持ち、整合が取れていない。

| 操作 | 実装 | membership | 出典 |
|---|---|---|---|
| 事業所削除 | soft delete (`activation_status=DELETED`) | 残す (`company_id` は `ON DELETE RESTRICT`) | `src/handlers/account-company.ts:166`, `db/schema.ts:146-170` |
| メンバー除名 / 退会 | membership を物理 DELETE | その 1 行を消す | `src/handlers/account-membership.ts:127-177` |
| アカウント削除 (退会) | user を物理 DELETE (cascade) | `user_id` の cascade で全消去 | `src/rpc/user-handler.ts:52-77`, `db/schema.ts:152` |

この非対称のため、**所属 0 件のまま生存するアカウント (orphan)** が複数の経路で発生し、しかも cleanup が存在しない (grep で確認した。`deleteUser` は明示的な退会からしか呼ばれず、membership 0 件を起因とする自動削除は無い)。PR #74 の signup ループ (`createSignupCompany` の 0 件ガードが削除済み company の残存 membership を数えて 409 を返し、`/account` と `/auth/signup/company` を往復する) は、この orphan を「正規の状態」として扱おうとして壊れた事例だった。

**ビジネス要件**: 登録ワークフローに事業所登録が含まれる以上、*どの事業所にも所属しないアカウントは存在してはならない*。orphan はサポート対象ではなく、不正な状態として排除する。

### 参照アーキテクチャ (freee アカウント基盤)

同等の要件を持つ freee の IAM (nest-auth) は、orphan を「所属 0 件になった瞬間にアカウントを削除する」方式で解いていた。事業所削除を起点に、巻き込まれた各ユーザーの所属を外し、所属が 0 件になったユーザーだけアカウントを削除する (`deleteOrphanedUser` は全 membership を数え、0 件の時だけ account を削除する)。事業所自体は論理削除で、最後の事業所の削除を阻むガードは無い。この ADR はこの「orphan になったら削除する」モデルを taimei-auth に採る。

## Decision

### 不変条件 (SSOT)

> 完了済みのアカウントは常に active membership を 1 件以上持つ。membership が 0 件になった瞬間にアカウントを削除する。唯一許容する 0 件の状態は signup の登録途中 (magic link 認証済みで、まだ一度も事業所を作っていない) だけで、これも恒久化させない。

「所属している」ことの判定点を「membership 行が存在する」ことだけにする。active かどうかを `activation_status` の filter に依存させない (filter の掛け忘れで壊れるためで、PR #74 がその実例である)。

### D1. 事業所削除は membership を物理削除する

`DeleteCompany` は対象 company の membership を tx 内ですべて物理 DELETE する。company 行は監査用に soft delete (`activation_status=DELETED`) のまま残す。これにより「membership 行が存在するなら、その company は ACTIVE である」が常に成り立ち、ghost membership に類するバグが構造的に消える。

### D2. orphan は即削除 (共有プリミティブ化)

membership が減るすべての経路の直後に、所属 0 件になったユーザーのアカウントを削除する。

```
deleteAccountIfOrphaned(userId, tx):
  active membership を数え、0 件なら deleteUser(userId, tx)
  (session / account / membership は schema の cascade で連動して削除される)
```

適用点:
- **事業所削除 (D1)**: OWNER の認可、audit、全 membership の物理削除、各元メンバーへの `deleteAccountIfOrphaned`、company の soft delete の順に行う。
- **退会 / 除名**: `deleteMembership` の直後に対象ユーザーへ `deleteAccountIfOrphaned` を行う。

### D3. 「最後の事業所削除」はアカウントも連動削除する

唯一の事業所を OWNER が削除した場合、その OWNER は membership 0 件の orphan になり、アカウントごと削除される (実質的な退会)。削除を実行する前に UI で「この操作でアカウントも閉じます」と明示的に警告し、削除後はログアウト状態へ遷移させる。actor が自分自身を削除するケースは handler で扱う (フロントへログアウト誘導の signal を返す)。

### D4. アカウント削除 (退会) は物理削除のまま据え置く

`DeleteUser` は現状の物理削除 (cascade) を維持する。`audit_log` は `user_id` に FK を持たない設計 (`db/schema.ts:125-140`) なので、account_delete の証跡は残る。論理削除と PII 消去への移行は、コンプライアンス要件が出た時点で別の ADR にする。sole-OWNER の事前チェック (`findCompaniesBlockingUserDeletion`) と OWNER が 1 人以上いるという不変条件 (`src/membership/apply-change.ts`) は維持する。(2026-09-10 追記) 不変条件の定義は CONTEXT.md「role」を定義元とする。判定の置き場は Repository の `withOwnerLockGuard` から Use-case 層の `src/membership/apply-change.ts` へ移した (ADR-0012 の層表「不変条件は Use-case」に合わせる)。OWNER が減りうる write の呼び出し側は `src/__tests__/effect-boundary.test.ts` の gate で固定する。

### D5. 登録途中の放棄は TTL sweep バッチで回収する

signup 中の一時的な 0 件アカウントは許容するが、恒久化させない。membership が 0 件で、作成から一定時間 (初期値 24h) が経過したアカウントを定期ジョブで削除する。

### D6. 削除処理は同期 transaction のまま行う

1 事業所あたりの関連データ量が小さい現状では、freee のような非同期 Job 化はしない。将来 company 配下のデータが大量になったら Job 化を再検討する (この前提をこの ADR に明記しておく)。

## Why

- **不変条件を行の存在に寄せる理由**: PR #74 は、「active を status filter で判定する」設計が 1 箇所の掛け忘れで壊れる脆さを実証した。membership 行の存在そのものを真実にすれば、判定点が FK と row count に集約され、掛け忘れが起きない。D1 はこの不変条件を物理的に保証する手段である。
- **orphan を削除する理由 (再 onboarding しない)**: 所属 0 件のアカウントは、ビジネス要件上あってはならない状態である。これを「signup へ送り直す正規の状態」として扱うと、PR #74 の往復ループのような不整合を恒常的に抱える。freee (nest-auth) も同じ要件を orphan の削除で解いており、参照実装がある。
- **最後の事業所削除を連動削除にする理由**: orphan を作らない不変条件の下では、最後の事業所削除は必然的にアカウント削除を伴う。ブロックして明示的な退会へ誘導する案より、1 操作で完結して導線が単純である。事故防止は削除前の明示的な警告で担保する。
- **退会を物理削除のまま据え置く理由**: 現状で監査要件 (audit_log の残存) は満たせており、論理削除化は大きな改修になる。要件が顕在化していない段階で先行投資しない。

## Consequences

- **挙動変更**: 「最後の事業所を削除するとアカウントが消える」。UI の警告とログアウト遷移が必須になる。
- **PR #74 の位置づけの変更**: `createSignupCompany` の active-filter ガードは、この ADR の後は「新規 signup (一度も事業所を持たないアカウントが最初の 1 件を作る)」専用の安全弁になる。既存の orphan の再 onboarding 経路 (全削除して `/auth/signup/company` に滞留する) は D1 と D2 により発生しなくなる。filter 自体は二重の安全弁として残す。
- **データ移行 (backfill) が必要**: 既に `DELETED` な company にぶら下がる残存 membership を一度物理削除し、その結果 orphan になったアカウントを回収する one-shot 処理を、`drizzle/manual/` ではなく管理スクリプト (`management/`) として用意する。
- **新規バッチ基盤**: D5 の TTL sweep ジョブの定期実行 (cron / scheduler) を追加する。
- **マイグレーション不要な部分**: D1 自体は tx 内の DELETE だけでスキーマ変更が無い。`membership.company_id` の `ON DELETE RESTRICT` は「company を物理削除しない」という現状の方針と矛盾しないため維持する。
- **race と冪等性**: 事業所削除の 2 度押しは、逐次なら membership 消滅後の 2 回目が membership guard で 403 になり (2026-09-21、ADR-0012 (B))、並行なら `softDeleteCompany` の `WHERE activation_status='ACTIVE'` で冪等になる。membership の物理削除も対象が 0 行なら no-op である。

## Did not adopt

### orphan を正規の状態としてサポートする (旧 D2 案)

所属 0 件のアカウントを再 onboarding の導線で生かす案。ビジネス要件「事業所に未所属のアカウントは存在してはならない」に反するため不採用。

### アカウント削除を論理削除 + PII 消去に変更する (freee D3 相当)

`user.activation_status` を足して論理削除化する案。監査要件は現状の audit_log で足りており、マイグレーションと全 user クエリの active filter 化のコストに見合わないため見送った。要件が顕在化した時に別の ADR にする。

### active-filter を SSOT ヘルパに集約するだけで D1 を入れない

`findActiveMembershipsByUserId` を新設し、すべての判定点をそこに通す案。membership 行は残るので「掛け忘れ」のリスクが残り、PR #74 と同種のバグが再発しうる。行の存在を真実にする D1 の方が強い。

## Implementation plan

1. **PR-1 (core: D1 + D2)**
   - repository: `removeMembershipsOfCompany(companyId, tx)`、`countActiveMembershipsByUserId(userId, tx)`、`deleteAccountIfOrphaned(userId, tx)` を `db/repositories/membership.ts` / `user.ts` に追加する。
   - `account-company.ts` の `DeleteCompany`: membership の物理削除、各元メンバーの orphan 削除、company の soft delete の順に行う。actor の自己削除時にはレスポンスで signal を返す。
   - `account-membership.ts` の除名 / 退会: `deleteMembership` の直後に `deleteAccountIfOrphaned` を行う。
   - テスト: 唯一の事業所を削除するとアカウントが消滅する / 複数所属の 1 件を削除しても他は無傷 / 2 度押しは冪等 / 事業所削除から退会まで dangling が無い。
2. **PR-2 (UX: D3)**: web の DangerZone / CompanySettings に「最後の事業所削除はアカウントを閉じる」警告とログアウト遷移を入れる。
3. **PR-3 (backfill)**: 既存の DELETED company の残存 membership の物理削除と orphan の回収。**rollback できない物理削除を初めて適用するため 2 段階** にする: まず dry-run で対象の membership / orphan user_id を全件出力して件数を確認し、確認後に小バッチと全 user_id のログ付きで実削除する。可能なら orphan を即座に物理削除せず、短い grace を置く。
4. **PR-4 (D5)**: 0 件アカウントの TTL sweep ジョブと定期実行の設定。D2 (即時の orphan 削除) の下では、永続的な 0 件状態は signup の登録途中だけなので、対象は新規 signup の放棄分である。sweep は `created_at < now-24h` AND active membership 0 件を対象とし、**実行中のリクエストの tx とは分離する** (既存ユーザーは D2 により 0 件で滞留しないが、安全側に寄せて対象判定を tx 分離で行い、進行中のリクエストを巻き込まない)。

### レビューで確定した追加の設計判断

- **actor と victim が異なる orphan 削除**: OWNER / ADMIN が他メンバーの最後の membership を除名すると、その victim は orphan 不変条件によりアカウントが連動して削除される。victim 本人は操作者ではないため、D3 の事前警告を受けられない。不変条件上この削除は必須とし、**actor 側に「このユーザーは他に所属が無く、除名でアカウントごと削除される」旨の確認** を出す (PR-2 の actor 向け確認に含める)。victim への事前通知はできない (仕様として受容する)。
- **SDK の companyId の 3 値問題**: SDK は companyId を「未選択 (undefined) か有効な所属か」の 2 値で扱うため、削除済み company を指す第 3 の状態を作ってはならない。後述する単一 tx のステップ 3 の `last_used_company_id` 再解決で、「companyId は生きている所属を指す」という契約を維持する。

## 設計レビュー反映 (placement / tx / session)

`/review-design` の 4 reviewer と DA を経て確定した実装制約である。

### レイヤ配置

- handler (薄い): RBAC、zod、`requireActor` / `requireMembership` の guard、`runInTransaction` の起動、エラーから status への変換だけを行う。
- use-case (厚い): `src/company/delete.ts` の DeleteCompany の orchestration と、`src/account/orphan.ts` の `deleteAccountIfOrphaned(userId, tx)` (orphan 判定はドメインルールなので use-case 層に置く)。
- repository (純粋なクエリ): `countActiveMembershipsByUserId` / `removeMembershipsOfCompany` を新設する。session 失効は既存の `revokeAllSessionsForUser`、user 削除は既存の `deleteUser`、company は既存の `softDeleteCompany` を再利用する。`deleteMembership` のような「判定と削除」の複合を repository に置かない。

### 単一 transaction の順序 (FK / RESTRICT との整合)

DeleteCompany は 1 つの `runInTransaction` 内で以下の順に行う。
1. その company の PENDING invitation を REVOKED にする
2. company の membership を物理削除する (`removeMembershipsOfCompany`)
3. **削除する company を `last_used_company_id` で指している全 user のその列を、その user の残存する active membership のいずれか (なければ NULL) に再解決する** (company は soft delete、つまり UPDATE なので `last_used_company_id` の `set null` FK が発火せず、SDK が `defaultCompanyId` で削除済み company を指し続ける dangling 参照になるのを防ぐ)
4. 元メンバー (重複排除済み) ごとに `deleteAccountIfOrphaned` を行い、残りの active membership が 0 件なら `revokeAllSessionsForUser` と `deleteUser` を行う
5. company を soft delete する (`activation_status=DELETED`、`deletedAt`)
6. audit を記録する (`company_deleted` と `membership_removed`)

`membership.company_id` の `ON DELETE RESTRICT` は **company 行の物理 DELETE** だけを阻む制約である。このフローは company を UPDATE (soft delete) するだけで物理削除しないため、FK 違反は起きない。membership は先に物理削除されるので、順序上も安全である。audit は同一 tx 内なら順序に依存しない (rollback で一緒に消える) が、既存の `deleteUser` の慣習に合わせ、mutation の前後どちらでも tx 内に置く。

### session 失効の cookieCache が stale になる窓を受容する

orphan 削除は本人がいない経路 (DeleteCompany / member remove / batch) で起きるため、`auth.api.signOut({headers})` を呼べない。`revokeAllSessionsForUser` (DB の `revoked_at`) と `deleteUser` の cascade で失効するが、better-auth の Redis secondaryStorage の cookieCache (`src/auth.ts` の `maxAge: 5*60`) は即時には無効化されず、**最大 5 分間、stale な session が valid に見える**。これは既存の退会 (`deleteUser` handler) が既に抱えている同根の制約で、orphan 削除も同じ経路を踏襲し、**同じ 5 分の窓を受容する** (詳細: `db/CLAUDE.md` ルール 2 の例外)。tx 内には DB 操作だけを置き、`auth.api.*` (HTTP / Redis の IO) を tx 内で呼ばない。

### 既存の soft-delete セマンティクスとの統合

既存の `account-company.ts` にある「membership / invitation は残す」というコメント (ADR-009 由来) はこの ADR で **更新する** (membership は物理削除、invitation は REVOKED にする)。company 行だけ soft delete を維持する点は変わらない。

### `/db/` 分離計画との整合 (transition note)

将来 `/db/` を別プロセスに切り出すと、この ADR の「単一 tx で 5 操作」は分散 tx ができないため成立しない。その時は `/db/` 側に DeleteCompany の一括 RPC を新設し、tx を `/db/` 内に閉じる設計へ転換する (現状の単一プロセスでは単一 tx が正しい)。

## 実装準備

### ブランチ戦略

各 PR を `main` 起点の独立したブランチで切る (PR 間は論理的な依存だけで、物理的な rebase の連鎖はしない)。命名は `feat/company-deletion-*` / `chore/*` とする。

### PR 分割計画 (≤5 files・≤2 commits/PR)

| PR | スコープ | 主ファイル | 依存 |
|----|----------|-----------|------|
| PR-1 | repository primitive + orphan use-case: `countActiveMembershipsByUserId` / `removeMembershipsOfCompany` / `reassignLastUsedCompany` / invitation 一括 REVOKED / `deleteAccountIfOrphaned` (src/account/orphan.ts) + 単体テスト | db/repositories/membership.ts, db/repositories/invitation.ts, db/repositories/user.ts, src/account/orphan.ts, db/__tests__ | - |
| PR-2 | DeleteCompany use-case (src/company/delete.ts、単一 tx の orchestration) + handler 配線 + member remove の orphan cleanup + 統合テスト + 既存コメント更新 | src/company/delete.ts, src/handlers/account-company.ts, src/handlers/account-membership.ts, src/company/__tests__ | PR-1 |
| PR-3 | UX (D3): web DangerZone / CompanySettings の「最後の事業所削除はアカウント削除」警告 + actor と victim が異なる場合の確認 + ログアウト遷移 | web/src/account/DangerZone.tsx, web/src/company/pages/CompanySettings.tsx, web/src/company/company-api.ts | PR-2 |
| PR-4 | backfill 管理スクリプト (2 段階: dry-run の後に batched な実削除 + 全 user_id のログ) | management/backfill-orphan-cleanup.ts | PR-2 |
| PR-5 | TTL sweep バッチ (0 件 AND created_at<now-24h) + 定期実行設定 | src/jobs/orphan-sweep.ts, db/repositories/user.ts | PR-2 |

### 手動 QA 手順 (Chrome DevTools MCP)

**環境**: http://auth.taimei-code.local:3100 (QA 実行時に確認する)

- QA-H-04 (最後の事業所削除からアカウント連動削除、ログアウトまで): sole OWNER で唯一の事業所を削除すると `/auth` などの未ログイン画面へ遷移し、再アクセスでセッションが無効であることを確認する。
- QA-M (D3 警告): CompanySettings / DangerZone で最後の事業所を削除する時に「アカウントも閉じる」警告が出ること、複数所属時は警告が出ないことを確認する。
- QA-M (actor と victim が異なる場合): OWNER が他に所属の無いメンバーを除名する画面で「このユーザーはアカウントごと削除される」という確認が出ることを確認する。
- QA-H-02 / QA-D-02 (他事業所が無傷): 複数所属ユーザーの 1 事業所を削除した後、残りの事業所が `/account` で正常に表示され、`current company` が dangling しないことを確認する (last_used_company_id 再解決の目視確認)。

UI を伴わない backend の挙動 (tx / cascade / FK / audit / 冪等 / orphan / last_used の再解決 / invitation 失効) は自動 QA で担保する。

### 自動 QA (bun test 仕様)

- **対象 AC**: 34 項目 (正常系 7 / 異常系 7 / エッジケース 6 / 非影響 5 / MECE追加 5 / DA追加 4)。
- QA-H-01,03,05,06,07 / QA-E-* / QA-D-01..03,06 / QA-R-* / QA-M-* / QA-DA-*: `src/company/__tests__/delete.test.ts` と `src/account/__tests__/orphan.test.ts`、`db/__tests__/membership.test.ts` に実 DB のテストとして実装する。
  - 唯一の事業所を削除すると user / session / membership が消滅し、company が DELETED になる (QA-H-04 の backend 部分)
  - 複数所属の 1 事業所を削除するとその membership だけが消え、他の所属と account は無傷である (QA-H-02 / QA-D-02)
  - 2 回削除しても冪等である (QA-H-03)。存在しない companyId は 404 になる (QA-E-04)
  - orphan 削除後に後続処理が失敗すると全 rollback される (QA-E-05)
  - last_used_company_id の再解決 (QA-M last_used)。PENDING invitation が REVOKED になり、DELETED company への accept が拒否される (QA-M invitation)
  - 異なる経路の競合を行ロックで直列化する (QA-M row-lock)。単一 tx で全 rollback する (QA-M single-tx)
  - TTL sweep の 24h 境界 (QA-D-05) と、既存ユーザーを巻き込まないこと (QA-DA TTL)
- QA-R-* (非影響): createSignupCompany / SetCurrentCompany / TransferOwnership / UpdateRole / invitation 受諾の既存テストが通ったままであることを確認する。

## References

- PR #74: signup ループの修正 (active-filter)。この ADR の発端。
- 参照実装: freee アカウント基盤 nest-auth の orphan からのアカウント削除 (`deleteOrphanedUser`)、CFO-Alpha の `destroy_with_users` / `deletable?` (最後の事業所のガード無し)。
- 関連: `db/schema.ts` (membership の FK)、`src/company/create.ts` (createSignupCompany の 0 件ガード)。

---

## 品質検証

- AC: 5 観点 × 必須 3 カテゴリ + observability + 非影響確認 5 件 = 25 項目を定義済み。詳細は 0010-company-account-deletion-lifecycle.analysis.md
- 技術リスク: 5 件を特定済み。詳細は 0010-company-account-deletion-lifecycle.analysis.md
- MECE 判定: 要修正 (Critical 4 件)。AC-26〜29 で対処済み / AC カバレッジ 30/30 (うち [MECE追加] 5 件) / 漏れ 4 件は対処済み / 重複 1 件。詳細は 0010-company-account-deletion-lifecycle.analysis.md
