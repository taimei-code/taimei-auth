# ADR-0012: taimei-auth の 4 層レイヤードアーキテクチャと membership guard 完成

## Status

Accepted (2026-07-19)。この ADR で「Guard 層の完成」、つまり `/api/account/*` の 14 route の認可入口を
`src/membership/guard/` に集約する対象に合意する。inline の `runInTransaction` を残す 6 route の
use-case 抽出は後続案件で扱う (下の「スコープ外」)。

2026-09-04 に [ADR-0017](./0017-effect-v4-full-adoption.md) の「ADR-0012 を次の点で補う」で、Guard 層の構成
(deps factory と `respond.ts`) と失敗を HTTP に変換する箇所を改めた。4 層の責務と依存方向は据え置きである。改めた内容は
ADR-0017 を定義元とし、以下の該当箇所は当時の設計として読む。

2026-09-21 に事業所削除 (`POST /api/account/companies/:companyId/delete`) を (C) 現状維持から (B) generic entry
(`requireMembership(..., "OWNER")`) へ移した。認可が use-case の存在判定より後にあり、非メンバーが 404 / 200 で
company の存在と状態を観測できていたためである。use-case 側の OWNER の再確認は lock 後の TOCTOU 再検証として残す。

## Context

直近の PR #103–#108 で membership guard の集約を進めた結果、認可の組み立ての target 側 (対象 membership の
取得と canChangeRole / canInviteRole / canAttemptRemoval / canRemoveTarget の呼び出し) が handler に
残ったままだった。具体的には `/api/account/*` の 3 handler、14 route に以下が散っていた。

- policy 述語 (`canChangeRole` / `canInviteRole` / `canAttemptRemoval` / `canRemoveTarget`) の直接呼び出しが 4 箇所
- target membership を raw な `findMembership` で直接 fetch する箇所が 5 箇所 (null を 404 に変換する処理の重複)
- `if (!r.ok) return c.json({ error: r.error }, r.status)` の envelope が 19 箇所
- `zod safeParse → 400 invalid_argument` のブロックが 8 箇所
- 401、400、403 の status 順序がコメント規約 (旧 `guard.ts:47`) として 3 route に分散

セキュリティ上の locality の問題も残っていた。#104 (ADMIN が invitation 経由で OWNER を作れた
脆弱性) の修正は handler の 1 つの if 文で、route レベルの回帰テストは 0 件だった。招待受諾は `invitation.role` を
無検査で membership に書くため、handler を通らない経路で OWNER の invitation 行が作られると受諾者が
OWNER になれる TOCTOU の窓が残っていた。

## Decision

### 4 層レイヤードアーキテクチャを採用する

| 層 | 場所 | 責務 |
|---|---|---|
| Transport | `src/handlers/`, `src/rpc/` | protocol の変換のみ (パラメータと zod の parse、guard、use-case、JSON 化の順) |
| Guard | `src/membership/guard/` + `src/membership/policy.ts` | 操作単位の認可を一度に判定する。Hono 非依存 |
| Use-case | `src/company/`, `src/membership/`, `src/invitation/`, `src/account/` | 業務手続を関数 1 つで表す。tx / audit / 不変条件 (OWNER が 1 人以上、orphan の連動削除) / TOCTOU 再検証を所有する |
| Repository | `db/repositories/` | 薄いままにする (db/CLAUDE.md のルールを維持)。判定を持たない |

**`src/membership/policy.ts` は Guard 層と Use-case 層が共有する純粋な述語と parser の kernel** である (isAtLeast /
canChangeRole / canInviteRole / canAttemptRemoval / canRemoveTarget /
verifyInviter など)。Use-case から policy を呼ぶのは正しい (accept use-case の tx 内の
再検証である verifyInviter の verdict がその代表例)。**禁止するのは Transport (handler / rpc) からの
policy 述語の直接呼び出しだけ** である。認可の組み立てを handler に散らさず、operation 単位の entry (Guard 層) か
use-case (Use-case 層) に集約する規律である (PR #103–#108 とこの ADR)。将来「cross-layer import の掃除」という
誤ったリファクタで policy の import を use-case から剥がさないよう、この節で固定しておく。

Transport の禁止事項: policy 述語の直接呼び出し / repository への直接 write / `runInTransaction` の所有。
Rails との対応: Controller が Transport、before_action と Pundit が Guard、Service Object が Use-case、
AR クエリが Repository にあたる。fat model を採らない理由は、identity DB レイヤの将来のプロセス分離
(CLAUDE.md の最上位制約) のために repository を薄く保つルール (db/CLAUDE.md ルール 2) が既にあり、
drizzle の行はデータだけでメソッドを持てないためである。

### Guard 層の構成 (directory module)

`src/membership/guard.ts` (旧 88 行) を `src/membership/guard/` に分割する。

- `index.ts`: 公開 façade (re-export)。handlers / rpc / tests の import パス `../membership/guard` を維持する
- `core.ts`: Actor / Result 型、`createMembershipGuard` factory、generic entry (`requireActor` / `requireMembershipOf` / `requireMembership`)
- `role-change.ts` / `removal.ts` / `transfer-ownership.ts` / `invite.ts` / `invitation-accept.ts`: 操作単位の entry
- `respond.ts`: `guardErrorResponse` と、error 文字列と status の catalog

閾値は 1 ファイル 200 行以下とする。後続案件で entry を足す場合も、1 操作 1 ファイルで同じディレクトリに追加する。

### 操作単位 entry の判定順

| entry | route | 内部で実行する判定 (この順) |
|---|---|---|
| `requireRoleChange` | POST `.../members/:targetUserId/role` | 401 (actor) → 400 (parseBody) → 403 (ADMIN 以上) → 404 (target membership) → 403 (canChangeRole) |
| `requireRemoval` | POST `.../members/:targetUserId/remove` | 401 → 403 (membership) → 403 (canAttemptRemoval) → 404 (target) → 403 (canRemoveTarget) ※body なし |
| `requireTransferOwnership` | POST `.../transfer-ownership` | 401 → 400 (parseBody + self 委譲 400) → 403 (OWNER) → 404 (target) → 400 (already_owner) |
| `requireInvite` | POST `.../invitations` | 401 → 403 (ADMIN 以上) → 400 (parseBody, details 付き) → 403 (canInviteRole) |
| `requireInvitationAccept` | POST `/api/account/accept-invitation` | 401 → 400 (parseBody) → 404 (token) → 403 (email_mismatch) → 既所属短絡 (ok, reused) → 410 (isAcceptable) |

`requireInvite` は現行実装の判定順 (403 ADMIN、400 parse、403 canInviteRole) を維持する。
`requireInvitationAccept` の既所属短絡は、「期限切れでも既所属なら 200 reused」という現行の冪等性を保つため
`isAcceptable` より先に配置する。

OWNER 招待受諾の再検証は entry (tx 外) ではなく、accept use-case (`src/invitation/accept.ts`) の
tx 内で行う。tx 外だと、(invitedByUserId, companyId) 行の role 判定と membership INSERT の commit の
間に降格の UPDATE が入る TOCTOU の窓が残る。

### error Response builder は Hono 非依存

`guardErrorResponse` は Web 標準の `Response.json` 相当を組む (`new Response(JSON.stringify(body), {...})`)。
Content-Type は明示的なヘッダで `application/json` を付与し、現行 Hono の `c.json()` (charset なしの
`application/json` を返す) との byte-invariant を維持する。charset の付与は、将来の Web 互換基準に応じて
統一的に導入するかを後続案件で検討する (現時点では success と error の間で Content-Type を一致させることを優先する)。

error 文字列と status の catalog は `respond.ts` に集約する (`GuardErrorResult` union)。route ごとに
error 文字列を散らばらせ、同じ文字列を別の status で返すずれが気付かれないまま起きることを防ぐ。

### route の仕分け (対象: `/api/account/*` 14 route)

- **(A) 操作単位 entry を新設する 5 route**: 上表のとおり `requireRoleChange` / `requireRemoval` /
  `requireTransferOwnership` / `requireInvite` / `requireInvitationAccept` を各 1 route に導入する。
- **(B) 既存の generic entry と envelope の 1 行化を行う 8 route**: GET memberships / GET members /
  GET invitations / 招待取消 / 事業所作成 (signup) / 事業所 add / 事業所編集 / 事業所削除 (上の Status 節)。認可が `requireActor` / `requireMembership` の generic entry で十分な route である。
- **(C) 現状維持の 1 route**: 事業所切替 (`POST /api/account/current-company`)。認可が use-case の tx 内に
  融合しており、レイヤ地図上の正しい位置にあるため触らない。事業所削除は (B) へ移した (上の Status 節)。

### 招待受諾の再検証を OWNER 招待に限定する脅威モデル

`invitation.role === "OWNER"` の accept は、accept tx 内で「招待者 (`invitedByUserId`) が現在も
OWNER である」ことを、(`invitedByUserId`, `invitation.companyId`) の 1 行を `SELECT ... FOR SHARE` で
lock しつつ再検証する (lookup 結果を `verifyInviter` が Accept / Reject に判定する)。ADMIN / MEMBER の招待は対象外にする。

理由:
- **OWNER**: 一度作られると、同事業所の他の OWNER でも「勝手に降格させる」には canChangeRole
  の OWNER ガードをくぐる必要があり、事後の撤回コストが高い。降格済み / 除名済みの inviter からの
  OWNER 追加は事後に撤回できないに近く、作る段階で塞ぐ必要がある。
- **ADMIN / MEMBER**: 誰かが降格 / 退会した後の有効期限内 (24h) に受諾しても、他の OWNER が事後に
  role 変更 / 除名で撤回できる。招待者が退会する正規のケース (「〇〇さんが招待して当日退職し、翌日に
  被招待者が受諾する」など) を壊すため、OWNER 招待だけを再検証の対象にする。

`verifyInviter(found)` は `src/membership/policy.ts` に置き、lookup 結果を `Accept | Reject(seen)` の直和型 (`_tag` で
判別する union) に判定する。`seen` は拒否時に見た招待者の状態 (`Demoted(role)` / `Missing`) で、拒否の規則が広がる時は
`verifyInviter` の分岐と `seen` の枝だけを足す。use-case は `Reject` を拒否に変換するだけで規則を持たない。未知の invitedRole は
DB の CHECK 制約により存在しない (ADR-0018)。

### tx isolation の前提 (READ COMMITTED)

FOR SHARE による直列化は Postgres の既定の isolation (READ COMMITTED) を前提にする。SERIALIZABLE で
運用する場合も (READ COMMITTED を起点に安全側の制約だけが追加される方向であれば) 挙動は変わらない。REPEATABLE READ や
それより低い isolation に切り替える予定が出た場合は、この ADR を re-open して再検証する (accept と降格の
2-outcome の不変条件が壊れうるため)。

FOR SHARE lock の対象は (`invitedByUserId`, `invitation.companyId`) の 1 行だけである。招待者の他事業所の
membership を巻き込んで lock しないことで、他事業所の role 変更との contention を避ける。この
scope が守られているかは、repository の `lockMembershipForShare(tx, userId, companyId)` のシグネチャで
静的に保証する (2 引数固定なので、他の company を巻き込みようがない)。

### `invitation_accept_rejected` audit event の運用契約

**event 型**: `invitation_accept_rejected` (`AuditLogEntry` union に追加する)。**発火経路**: acceptInvitation
use-case の reject 分岐 (double_accept / inviter_not_owner_or_missing)。

**payload keys** (固定): `invitation_id` / `company_id` / `invited_by_user_id` / `attempted_role` /
`inviter` / `reason`。`inviter` は再検証で見た招待者の状態 `{ _tag: "Demoted", role }` / `{ _tag: "Missing" }`
で、double_accept (lookup に到達しない) では `null` になる (2026-09-17 に `inviter_current_role: Role | null` から置き換えた。
それ以前の行は旧 key を持つ)。**PII (email など) は含めない**。invitation_id から辿れるため、ログ集約系への
露出面を作らない。

**at-least-once の近似**: reject 経路は accept tx を rollback した後、rollback 後に console.warn
(structured payload の JSON) を先に出力し、その後に別 tx で `recordInvitationAcceptRejected` を実行する。
DB の INSERT が isolate の crash や DB 断で落ちても、wrangler tail に痕跡が残る。正常な accept 経路では
warn / audit を一切発火しない (拒否経路との対称性を保ち、監視の false-positive を出さない)。

**監視クエリ (Datadog logs / wrangler tail)**:

- Datadog logs: `service:taimei-auth message:invitation_accept_rejected` で JSON payload を
  抽出できる。alert クエリの例: `logs("service:taimei-auth invitation_accept_rejected").index("*").rollup("count").last("5m") > 3` (5 分あたり 3 件超で PagerDuty)。
- audit_log (DB): `SELECT payload FROM audit_log WHERE event_type = 'invitation_accept_rejected' AND created_at > now() - interval '1 day'` で長期の傾向を追跡する。

**alert 閾値**: 5 分間で 3 件超 (`> 3 / 5m`)。false-positive を抑えるため、1 件だけの散発では
ページしない。真の攻撃時は多数の受諾試行が短時間に集中する想定である。

**owner**: taimei auth 担当 (現状は @YasuakiOmokawa 個人が対応。チーム化した時に auth-oncall に委譲する)。

## Consequences

- **挙動変更 (accept 経路の新しい 410)**: 現役の OWNER でない inviter が過去に出した OWNER 招待の accept が
  新たに 410 で拒否される。SPA (`web/src/invitation/pages/SignUpAcceptInvitation.tsx`) の既存の 410 分岐が新経路
  も既存の UI 文言 (期限切れ / 使用済み) で吸収するため、SPA の変更は無い。
- **byte-invariant な移行**: 移行対象 12 route の response body / status / Content-Type は
  変更前と JSON の deep-equal で一致する。fixture (`src/handlers/__tests__/__fixtures__/expected/`) は
  handler 移行前 (main と同一コードの時点) の実際の response から取得したもので、以後の変更は
  `account-routes-migrated.test.ts` の snapshot 比較が回帰として検知する (main を直接再実行する
  機械比較ではなく、取得時点の正しさはコードレビューで担保する)。
- **セキュリティ回帰テストの追加**: #104 (ADMIN による role=OWNER の招待) の route レベルの 403 が
  fixture snapshot に追加され、guard entry から外れる regression を CI が検知する。
- **audit event の運用負荷の増加**: `invitation_accept_rejected` の Datadog alert を新設する。false-positive を
  抑えるため、5 分 3 件の threshold を初期値にする。誤検知が続く場合はこの ADR を re-open して調整する。

## Scope out (後続案件)

- handler が inline に `runInTransaction` を持つ残り 6 route の use-case 抽出 (role 変更 / 委譲 /
  事業所編集 / 事業所切替 / 招待の作成と取消。受諾はこの案件で抽出済み)。
- RPC 面 (`/rpc/*`) への guard の適用 (現状は better-auth の X-Service-Key での認証のみ)。
- `resolve-email-context.ts` / `spa-fallback.ts` の削除検討 (いずれも呼び出し元が 1 箇所の shallow
  module。アーキテクチャレビューで判定済み)。

## Did not adopt

- **operation entry を Transport 側の helper (`hono/factory` の createFactory) に置く案**: Guard 層の
  Hono 非依存性が失われ、identity DB を RPC 化する将来の分離で Transport ごと差し替える必要が出る。
  Web 標準の `Response.json` で組めば同じ 1 行の API で済むうえ、テストで hono を起動する必要も無くなる
  (副次効果)。
- **OWNER 招待の再検証を entry 側で行う案 (tx 外)**: 判定と membership INSERT の commit の間に降格の
  UPDATE が入る TOCTOU の窓が残る。tx 内の FOR SHARE だけが構造的に閉じられる。設計レビューで再確認済み。
- **audit event に email を含める案**: 監視の可読性は上がるが PII の露出面が広がる。invitation_id
  から audit_log と invitation の join で辿れるため冗長である。
- **charset=UTF-8 の Content-Type への明示的な切り替え**: `Response.json()` と `c.json()` の現行の挙動がいずれも
  charset なしの `application/json` で一致しており、明示的に切り替えると byte-invariant が崩れる。将来 Web 標準の
  推奨が変わった時に両者を一括で切り替える (SPA と consumer 側の分岐の前提と合わせて)。
