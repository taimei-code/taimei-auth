# ADR-0018: role の値域を DB の CHECK 制約で固定し、app 側の未知 role 防御を撤去する

## Status

Accepted (2026-09-11)。判断主体は maintainer。設計上の論点と採らなかった案は本 ADR の Alternatives / Consequences に集約する。

関連: ADR-0012 (OWNER 招待再検証と `invitation_accept_rejected`)、CONTEXT.md の **role** / **fail-closed / fail-open**。

## Context

`membership.role` と `invitation.role` は `text` 列である。値域 (`OWNER` / `ADMIN` / `MEMBER`) を宣言していたのは drizzle の `$type<Role>()` という型注釈だけで、DB はどんな文字列でも受け入れた。

型は `Role` と言っている。しかし code は信じていなかった。`isAtLeast` / `isKnownRole` / `requiresOwnerProtection` は `Object.hasOwn` で未知 role を弾き (PR #103 / #105、prototype pollution 対策)、`acceptInvitation` は `unknown_invited_role` の分岐を持ち、`roleLabelJa` は fallback を持ち、SPA は `role ?? ""` と `as Role` で埋めていた。同じ 1 列が `Role` / `string` / `{ role: string }` の 3 通りの型で流れ、`isKnownRole(invitation.role)` のように型上は到達できない分岐が本番コードに残っていた。検査の結果を型に残さないので、下流が読むたびに検査し直す。Alexis King が "Parse, don't validate" で shotgun parsing と呼ぶ形である。

では、この防御は何から守っていたのか。role を書く経路を数えると、repository の `insertMembership` / `updateMembershipRole` / `createInvitation` と test seed の 4 つで、いずれも引数が `Role` である。app 側は parse 済みの値しか書いていない。守っていたのは「DB に直接書かれた未知値」だけで、それを止める場所は app ではなく DB にある。

## Decision

- `membership.role` / `invitation.role` に `CHECK (role in ('OWNER', 'ADMIN', 'MEMBER'))` を置く (migration `0012`)。role の値域の正本は DB 制約で、`$type<Role>()` はその事実の型表現になる。`db/schema.ts` の `ROLES` const から `Role` を派生し、CHECK は `inArray(table.role, ROLES).inlineParams()` で `ROLES` から導出し、DB test (`db/__tests__/role-check.test.ts`) が全値の受理と外れ値の拒否を固定する
- app 側の未知 role 防御を全て撤去し、policy / repository / audit payload / SPA の wire 型を `Role` に狭める。`RejectReason` から `unknown_invited_role` を外す。`requiresOwnerProtection` は `=== "OWNER"` に inline する
- CONTEXT.md の **fail-closed / fail-open** から「role が未知」を外し、**role** に不変条件を書く

## Alternatives

- repository の純関数 `parseRole` + `UnknownRole` failure (読み出し時に parse): 一覧 API で未知 role の行を読んだ時の扱い (500 / 除外) という新しい判断が要り、CHECK があれば死にコードになる
- 両方 (CHECK + `parseRole`): 二重防御だが、CHECK が効いていれば `parseRole` の失敗経路は到達不能になり、消しても複雑さが戻らない
- `pgEnum("role", ROLES)`: 保証は同等だが、値の追加が `ALTER TYPE ... ADD VALUE` (transaction 内で使えない) になり、列型の変更も伴う。text 列 + CHECK は制約の付け外しだけで済む
- 何もしない: `Object.hasOwn` の防御は正しく動くが、防御の存在理由 (DB に未知値が入りうる) を型が言えず、読み手ごとに再実装が散る (5 箇所)

## Consequences

- 違反行のある環境では migration が失敗し deploy が止まる (fail-closed)。本番は 2026-09-11 に 3 値のみを確認済み。test 由来の `"SUPERVISOR" as Role` は seed できなくなり、該当 test (policy 6 件、accept 1 件、seed 1 件) は削除した
- 将来 role を増やす時は migration (CHECK の作り直し) が要る。role の追加は権限モデルの変更で policy / UI / ADR を伴うため、migration 1 本の追加コストは相対的に小さい
- SPA は `getJson<T>` の `as T` で応答を信じるため、CHECK は web には届かない。web の `role: Role` 宣言は他 field と同じ信頼水準。本物の parse は web の応答を zod で読む別件
- 同じ手が `org_code` / `activation_status` / `invitation.status` の text 列に使える
- prototype pollution 系の test (`"toString"` / `"constructor"`) は、引数が `Role` になり型で表現不能になるため `@ts-expect-error` の型レベル test 1 件に置き換えた
- `recordInvitationAcceptRejected` の `reason` は `string` のまま (db/ が src/ の型を import しない分担)。監視 query が `reason = 'unknown_invited_role'` を参照していても、値が来なくなるだけで query は壊れない
