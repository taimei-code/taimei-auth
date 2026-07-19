# ADR-0012: taimei-auth の 4 層レイヤードアーキテクチャと membership guard 完成

## Status

Accepted (2026-07-19)。本 ADR で「Guard 層の完成」= `/api/account/*` 14 route の認可入口を
`src/membership/guard/` に集約する対象に合意する。inline `runInTransaction` を残す 6 route の
use-case 抽出は後続案件で扱う (下の「スコープ外」)。

## Context

直近 PR #103–#108 で membership guard 集約を進めた結果、認可の組み立ての target 側 (対象 membership の
取得と canChangeRole / canInviteRole / canAttemptRemoval / canRemoveTarget の呼び出し) が handler に
残ったままだった。具体的には `/api/account/*` の 3 handler・14 route に以下が散っていた:

- policy 述語 (`canChangeRole` / `canInviteRole` / `canAttemptRemoval` / `canRemoveTarget`) の直呼び 4 箇所
- target membership の raw `findMembership` 直 fetch 5 箇所 (null → 404 の写像重複)
- `if (!r.ok) return c.json({ error: r.error }, r.status)` envelope 19 箇所
- `zod safeParse → 400 invalid_argument` ブロック 8 箇所
- 401→400→403 の status 順序がコメント規約 (旧 `guard.ts:47`) として 3 route に分散

セキュリティ上の locality ギャップも残っていた: #104 (ADMIN が invitation 経由で OWNER を mint できた
脆弱性) の修正は handler 1 if 文で、route レベルの回帰テストは 0 件。招待受諾は `invitation.role` を
無検査で membership に書くため、handler を通らない経路で OWNER invitation 行が作られると受諾者が
OWNER になれる TOCTOU 窓が残っていた。

## Decision

### 4 層レイヤードアーキテクチャを採用する

| 層 | 場所 | 責務 |
|---|---|---|
| Transport | `src/handlers/`, `src/rpc/` | protocol 変換のみ (パラメータ / zod parse → guard → use-case → JSON 化) |
| Guard | `src/membership/guard/` + `src/membership/policy.ts` | 操作単位の認可を一発回答。Hono 非依存 |
| Use-case | `src/company/`, `src/membership/`, `src/invitation/`, `src/account/` | 業務手続 = 関数 1 つ。tx / audit / 不変条件 (OWNER≥1, orphan 連動削除) / TOCTOU 再検証を所有 |
| Repository | `db/repositories/` | 薄いまま (db/CLAUDE.md ルール維持)。判定を持たない |

**`src/membership/policy.ts` は Guard 層と Use-case 層が共有する純粋述語 kernel** (isAtLeast /
isKnownRole / canChangeRole / canInviteRole / canAttemptRemoval / canRemoveTarget /
canAcceptInvitedRole 等)。Use-case から policy 述語を呼ぶのは正しい (accept use-case の tx 内
再検証 = canAcceptInvitedRole がその代表例)。**禁止対象は Transport (handler / rpc) からの
policy 述語直呼びだけ** — 認可の組み立てを handler に散らさず、operation 単位 entry (Guard 層) か
use-case (Use-case 層) に集約する規律 (PR #103–#108 + 本 ADR)。将来「cross-layer import 掃除」の
誤リファクタで policy import を use-case から剥がさないよう本節で pin する。

Transport の禁止事項: policy 述語直呼び / repository への直接 write / `runInTransaction` 所有。
Rails との対応: Controller=Transport / before_action+Pundit=Guard / Service Object=Use-case /
AR クエリ=Repository。fat model を採らない理由: identity DB レイヤの将来プロセス分離
(CLAUDE.md 最上位制約) のため repository を薄く保つルール (db/CLAUDE.md ルール 2) が既にあり、
drizzle 行はデータのみでメソッドを持てない。

### Guard 層の構成 (directory module)

`src/membership/guard.ts` (旧 88 行) を `src/membership/guard/` に分割する:

- `index.ts` — 公開 façade (re-export)。handlers / rpc / tests の import path `../membership/guard` を維持
- `core.ts` — Actor / Result 型・`createMembershipGuard` factory・generic entry (`requireActor` / `requireMembershipOf` / `requireMembership`)
- `role-change.ts` / `removal.ts` / `transfer-ownership.ts` / `invite.ts` / `invitation-accept.ts` — 操作単位 entry
- `respond.ts` — `guardErrorResponse` + error 文字列 × status catalog

閾値: 1 ファイル ≤200 行。後続案件で entry を足す場合も 1 操作 1 ファイルで同ディレクトリに追加する。

### 操作単位 entry の判定順

| entry | route | 内部で実行する判定 (この順) |
|---|---|---|
| `requireRoleChange` | POST `.../members/:targetUserId/role` | 401 (actor) → 400 (parseBody) → 403 (ADMIN 以上) → 404 (target membership) → 403 (canChangeRole) |
| `requireRemoval` | POST `.../members/:targetUserId/remove` | 401 → 403 (membership) → 403 (canAttemptRemoval) → 404 (target) → 403 (canRemoveTarget) ※body なし |
| `requireTransferOwnership` | POST `.../transfer-ownership` | 401 → 400 (parseBody + self 委譲 400) → 403 (OWNER) → 404 (target) → 400 (already_owner) |
| `requireInvite` | POST `.../invitations` | 401 → 403 (ADMIN 以上) → 400 (parseBody, details 付き) → 403 (canInviteRole) |
| `requireInvitationAccept` | POST `/api/account/accept-invitation` | 401 → 400 (parseBody) → 404 (token) → 403 (email_mismatch) → 既所属短絡 (ok, reused) → 410 (isAcceptable) |

`requireInvite` は現行実装の判定順 (403 ADMIN → 400 parse → 403 canInviteRole) を維持する。
`requireInvitationAccept` の既所属短絡は「期限切れでも既所属なら 200 reused」という現行の冪等性を保つため
`isAcceptable` より先に配置する。

OWNER 招待受諾の再検証は entry (tx 外) でなく、accept use-case (`src/invitation/accept.ts`) の
tx 内で行う。tx 外だと (invitedByUserId, companyId) 行の role 判定と membership INSERT commit の
間に降格 UPDATE が入る TOCTOU 窓が残る。

### error Response builder は Hono 非依存

`guardErrorResponse` は Web 標準 `Response.json` 相当を組む (`new Response(JSON.stringify(body), {...})`)。
Content-Type は明示ヘッダで `application/json` を付与し、現行 Hono `c.json()` (charset なし
`application/json` を返す) と byte-invariant を維持する。charset= 付与は将来の Web 互換基準に応じて
統一導入を後続案件で検討 (現時点では success/error 間の Content-Type を一致させることを優先)。

error 文字列 × status の catalog は `respond.ts` に集約 (`GuardErrorResult` union)。route から
error 文字列を散らばらせて同じ文字列を別 status で返す silent なずれを防ぐ。

### route 仕分け (対象: `/api/account/*` 14 route)

- **(A) 操作単位 entry 新設 5 route**: 上表のとおり `requireRoleChange` / `requireRemoval` /
  `requireTransferOwnership` / `requireInvite` / `requireInvitationAccept` を各 1 route に導入。
- **(B) 既存 generic entry + envelope 1 行化 7 route**: GET memberships / GET members /
  GET invitations / 招待取消 / 事業所作成 (signup) / 事業所 add / 事業所編集。認可が
  `requireActor` / `requireMembership` の generic entry で十分な route。
- **(C) 現状維持 2 route**: 事業所切替 (`POST /api/account/current-company`) / 事業所削除
  (`POST /api/account/companies/:companyId/delete`) — 認可が use-case・tx 内に融合しており
  (TOCTOU 対策 / OWNER≥1 + orphan 連動削除のロジック内 chain)、レイヤ地図上の正位置のため触らない。

### 招待受諾の再検証を OWNER 招待に限定する脅威モデル

`invitation.role === "OWNER"` の accept は accept tx 内で「招待者 (`invitedByUserId`) が現在も
OWNER である」ことを (`invitedByUserId`, `invitation.companyId`) 1 行の `SELECT ... FOR SHARE` で
lock しつつ再検証する (`canAcceptInvitedRole` 述語)。ADMIN/MEMBER 招待は対象外にする。

理由:
- **OWNER**: 一度 mint されると同事業所の他 OWNER でも「勝手に降格させる」ためには canChangeRole
  の OWNER ガードをくぐる必要があり、事後撤回のコストが高い。降格済み / 除名済み inviter からの
  OWNER 追加は事後撤回不能に近く、mint 段階で塞ぐ必要がある。
- **ADMIN / MEMBER**: 誰かが降格 / 退会したあと有効期限内 (24h) に受諾しても、他 OWNER が事後で
  role 変更 / 除名で撤回可能。招待者退会の正規ケース (「〇〇さんが招待して、当日退職 → 翌日に
  被招待者が受諾」等) を壊すため、OWNER 招待だけを再検証対象にする。

述語 `canAcceptInvitedRole(invitedRole, inviterCurrentRole)` は `src/membership/policy.ts` に置き、
未知 invitedRole (role 列に直 INSERT された unknown 文字列) は `Object.hasOwn` で fail-closed に
拒否する (`isAtLeast` と同じ prototype pollution 対策)。inviter membership 不在 (null) は OWNER
招待に限り false、ADMIN/MEMBER 招待は true (前段の理由と対称)。

### tx isolation の前提 (READ COMMITTED)

FOR SHARE 直列化は Postgres の default isolation (READ COMMITTED) を前提にする。SERIALIZABLE で
運用する場合も (READ COMMITTED 起点で追加安全のみ動く方向であれば) 挙動不変。REPEATABLE READ /
lower isolation に切り替える予定が出た場合は本 ADR を re-open して再検証する (accept vs 降格の
2-outcome 不変条件が壊れうるため)。

FOR SHARE lock の対象は (`invitedByUserId`, `invitation.companyId`) の 1 行のみ。招待者の他事業所
membership を巻き込んで lock しないことで、他事業所 role 変更との contention を避ける。この
scope が守れているかは repository の `lockMembershipForShare(tx, userId, companyId)` シグネチャで
静的に保証 (2 引数固定で other companies を巻き込みようがない)。

### `invitation_accept_rejected` audit event の運用契約

**event 型**: `invitation_accept_rejected` (`AuditLogEntry` union に追加)。**発火経路**: acceptInvitation
use-case の reject 分岐 (double_accept / inviter_not_owner_or_missing / unknown_invited_role)。

**payload keys** (固定): `invitation_id` / `company_id` / `invited_by_user_id` / `attempted_role` /
`inviter_current_role` / `reason`。**PII (email 等) は含めない** — invitation_id から辿れるため
ログ集約系への露出面を作らない。

**at-least-once 近似**: reject 経路は accept tx を rollback したあと、rollback 後に console.warn
(structured payload の JSON) を先行 emit → その後別 tx で `recordInvitationAcceptRejected` を実行。
DB INSERT が isolate crash / DB 断で落ちても wrangler tail に痕跡が残る。正常 accept 経路では
warn / audit を一切発火しない (拒否経路との対称性 = 監視の false-positive を出さない)。

**監視クエリ (Datadog logs / wrangler tail)**:

- Datadog logs: `service:taimei-auth message:invitation_accept_rejected` で JSON payload を
  抽出可能。alert クエリ例: `logs("service:taimei-auth invitation_accept_rejected").index("*").rollup("count").last("5m") > 3` (5 分あたり 3 件超で PagerDuty)。
- audit_log (DB): `SELECT payload FROM audit_log WHERE event_type = 'invitation_accept_rejected' AND created_at > now() - interval '1 day'` で長期の trend 追跡。

**alert 閾値**: 5 分間で 3 件超 (`> 3 / 5m`)。false-positive 抑制のため 1 件だけの散発は
ページしない。真の攻撃時は多数の受諾試行が短時間に集中する想定。

**owner**: taimei auth 担当 (現状 @YasuakiOmokawa 個人が対応。チーム化時に auth-oncall に委譲)。

## Consequences

- **挙動変更 (accept 経路の新 410)**: 現役 OWNER でない inviter が過去に投げた OWNER 招待の accept が
  新たに 410 で拒否される。SPA (`web/src/pages/SignUpAcceptInvitation.tsx`) の既存 410 分岐が新経路
  も既存 UI 文言 (期限切れ/使用済み) で吸収するため、SPA 変更なし。
- **byte-invariant migration**: 移行対象 12 route の response body / status / Content-Type は
  変更前と JSON deep-equal で一致。fixture (`src/handlers/__tests__/__fixtures__/expected/`) は
  handler 移行前 (main と同一コード時点) の実 response から capture したもので、以後の変更は
  `account-routes-migrated.test.ts` の snapshot 比較が回帰として検知する (main を直接再実行する
  機械比較ではなく、capture 時点の正しさはコードレビューで担保)。
- **セキュリティ回帰テストの追加**: #104 (ADMIN が role=OWNER 招待) の route レベル 403 が
  fixture snapshot に追加され、guard entry から外れる regression を CI が検知する。
- **audit event の運用負荷増**: `invitation_accept_rejected` の Datadog alert を新設。false-positive
  抑制のため 5 分 3 件 threshold を初期値にする。誤検知が続く場合は本 ADR を re-open して調整。

## Scope out (後続案件)

- handler が inline に `runInTransaction` を持つ残り 6 route の use-case 抽出 (role 変更 / 委譲 /
  事業所編集 / 事業所切替 / 招待の作成・取消。受諾は本案件で抽出済み)。
- RPC 面 (`/rpc/*`) への guard 適用 (現状は better-auth の X-Service-Key での認証のみ)。
- `resolve-email-context.ts` / `spa-fallback.ts` の削除検討 (いずれも呼び出し元 1 箇所の shallow
  module。アーキテクチャレビューで判定済み)。

## Did not adopt

- **operation entry を Transport 側 helper (`hono/factory` の createFactory) に置く案**: Guard 層の
  Hono 非依存性が失われ、identity DB を RPC 化する将来の分離で Transport ごと差し替える必要が出る。
  Web 標準 `Response.json` で組めば同じ 1 行 API で済む上、テストで hono を起動する必要も無くなる
  (副次効果)。
- **OWNER 招待の再検証を entry 側で行う案 (tx 外)**: 判定と membership INSERT commit の間に降格
  UPDATE が入る TOCTOU 窓が残る。tx 内 FOR SHARE で唯一構造的に閉じる。設計レビューの再確認。
- **audit event に email を含める案**: 監視の可読性は上がるが PII 露出面が広がる。invitation_id
  から audit_log / invitation の join で辿れるため冗長。
- **charset=UTF-8 の Content-Type 明示切替**: `Response.json()` / `c.json()` の現行挙動がいずれも
  charset なし `application/json` で一致しており、明示切替は byte-invariant を崩す。将来 Web 標準の
  推奨が変わったタイミングで両者を一括で切り替える (SPA / consumer 側の分岐 assumption と合わせて)。
