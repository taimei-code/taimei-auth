# Changelog

## 3.3.0 — 2026-10-06

consumer が、自分の DB にある事業所と人がまだ taimei-auth で有効かを照合できるよう、service key で呼ぶ RPC を足す。抜けた人と削除された事業所のデータを consumer が消すために使う。追加だけで、wire 互換は保つ。

### Features

- `createAuthClient` の戻り値に `companyService` を追加した。`companyService.checkMemberships({ companyId, userIds })` は `{ companyActive, memberUserIds }` を返す。値の約束 (ACTIVE の判定、渡した人のうち所属する人だけを返すこと、入力の上限) は proto の `CheckMembershipsRequest`・`CheckMembershipsResponse` のコメントにある
- proto に `CompanyService.CheckMemberships` と、`CheckMembershipsRequest`・`CheckMembershipsResponse` を追加した。名前とメールアドレスは返さない

### Breaking changes

なし。公開 API の追加だけ (additive)。

### 移行

- auth ホストを先に展開してから 3.3.0 の `checkMemberships` を呼ぶ。`CompanyService` を持たない auth ホストに呼ぶと、Connect の `Unimplemented` か `NotFound` で失敗する。失敗を「事業所が無い」と扱わない

## 3.2.0 — 2026-10-05

consumer が現在の事業所のメンバー一覧を取れるよう、session token を受ける RPC を足す。consumer は事業所の ID を渡さず、auth ホストがセッションの user の現在の事業所で一覧を決める。追加だけで、wire 互換は保つ (`buf breaking` 通過)。

### Features

- guard に `listMembers()` を追加した。戻り値は `ListMembersResult` (`{ ok: true; data: { companyId?, members } } | { ok: false; reason }`) である。どの事業所の一覧か、空の時の意味、順序の約束は proto の `ListCurrentCompanyMembersOk` のコメントにある
- `listMembers()` は `getSession()` と一覧の RPC を順に呼ぶ。`getSession()` が失敗すればその結果を返し、一覧の RPC は呼ばない。一覧の事業所が `SessionData.companyId` と違えば `{ ok: false, reason: UNSPECIFIED }` を返す。2 回の呼び出しの間に利用者が事業所を切り替えると、別の事業所の一覧が返りうるためである
- `Member` (`userId`・`name`・`email`・`role`) と `ListMembersResult` 型を export した
- proto に `AuthService.ListCurrentCompanyMembers` と、`CompanyMember`・`ListCurrentCompanyMembersRequest`・`ListCurrentCompanyMembersOk`・`ListCurrentCompanyMembersResponse` を追加した
- SDK が知らない role のメンバーは `role` を `undefined` にして返す。consumer は `SessionData.role` と同じく権限なしとして扱う

### Breaking changes

なし。公開 API の追加だけ (additive)。`SessionData` は変えていない。

### 移行

- auth ホストを先に展開してから 3.2.0 に上げる。`ListCurrentCompanyMembers` を持たない auth ホストに 3.2.0 から呼ぶと、`listMembers()` は `{ ok: false, reason: UNSPECIFIED }` を返す

## 3.1.0 — 2026-10-04

consumer が現在の事業所での role で操作を分けられるよう、VerifySession の応答に role を足す。追加の RPC は要らず、`getSession()` 1 回で companyId と role がそろう。proto の field 追加だけで、wire 互換は保つ (`buf breaking` 通過)。

### Features

- `SessionData.role?: Role` (`"OWNER" | "ADMIN" | "MEMBER"`) を追加した。値の約束 (どの事業所の role か、`undefined` の扱い) は proto の `VerifySessionOk.current_role` のコメントにある
- `Role` 型を export した
- proto に `Role` enum と `VerifySessionOk.current_role` を追加した

### Breaking changes

なし。`SessionData` への optional field の追加だけ (additive)。

### 移行

- auth ホストを先に展開してから 3.1.0 に上げる。`current_role` を返さない auth ホストに 3.1.0 から接続すると、`role` は常に `undefined` (権限なし) になる

## 3.0.0 — 2026-10-03

consumer が使っていない RPC を削除する。consumer は taimei だけで、本番の経路で呼ぶのは `AuthService.VerifySession` と `UserService.FindUserByEmail` だけだった。削除した RPC を 2.x の client から呼ぶと、auth ホストは 404 を返す。

### Breaking changes

- `AuthService.GetUser` / `AuthService.FindAccountByUserId` / `AuthService.SignOut` / `AuthService.SendMagicLink` と `UserService.FindUserById` の RPC を削除した。`createAuthClient` が返す `authService` と `userService` から、対応する method (`getUser` / `findAccountByUserId` / `signOut` / `sendMagicLink` / `findUserById`) が消える
- 上の RPC だけが使っていた message を削除した: `GetUserRequest` / `GetUserResponse` / `FindAccountByUserIdRequest` / `FindAccountByUserIdResponse` / `Account` / `SignOutRequest` / `SignOutResponse` / `SendMagicLinkRequest` / `SendMagicLinkResponse` / `FindUserByIdRequest` / `FindUserByIdResponse`
- service key で呼べる操作は `VerifySession` (session token の検証) と `FindUserByEmail` (email による user の参照) だけになった。OAuth の token を返す `FindAccountByUserId` も無くなる

### 移行

- `userService.findUserById` を呼んでいるコードを消す (taimei は test からしか呼ばない wrapper を消す)。他の削除した method は taimei が呼んでいない
- sign-out と magic link の送信は、今までどおり共通画面 SPA が better-auth で行う

## 2.0.0 — 2026-10-03

使われていない公開 API を削除する。consumer は taimei だけで、削除した API をどれも使っていないので、code の変更は要らない (version を上げるだけでよい)。deprecate を挟まずに削除したのは、consumer が 1 つで利用が無いことを確認できたため。削除した RPC を 1.x の client から呼ぶと、auth ホストは 404 を返す。

### Breaking changes

- `UserService.UpdateUser` と `UserService.DeleteUser` の RPC を削除した。service key だけで任意の user を書き換え・削除できる API で、呼び手が無かった。名前と画像の変更、退会は共通画面 SPA で本人の session を使って行う
- `buildAuthLogoutUrl` / `BuildAuthLogoutUrlOptions` を削除した (1.2.0 で `@deprecated`)。sign-out は共通画面 SPA の `authClient.signOut()` で行う
- `mapConnectError` と `AuthServiceUnavailable` / `AuthServiceTimeout` / `AuthServiceUnauthorized`、`./errors` subpath を削除した
- `effect` を `dependencies` から外した (上の error class だけが使っていた)

### Internal

- build は `tsconfig.build.json` で test を除いて compile し、build の前に `dist` を消すようにした (今までは削除済みの出力や test の compile 結果が tarball に入りえた)。test の型検査は root の `bun run typecheck` が行う

## 1.2.1 — 2026-09-24

### Documentation

- `SessionData.companyId` のコメントを JSDoc にし、`.d.ts` に出るようにした (1.2.0 では行コメントだったため consumer の型に出ていなかった)

## 1.2.0 — 2026-09-24

振る舞いは変えない。公開 API の deprecation を含むので minor bump。

### Documentation

- `companyId` の約束を proto の `User.default_company_id` のコメントに書いた (生成型の JSDoc にも出る)
- proto の `Session.company_id` のコメントを事実に合わせた (書き込む処理が無く、値は常に空)

### Deprecations

- `buildAuthLogoutUrl` / `BuildAuthLogoutUrlOptions` を `@deprecated` にした。組み立てた `/auth/sign-out` に応答する route は auth ホストに無く (SPA の fallback が 200 を返すだけで session は残る)、sign-out は共通画面 SPA の `authClient.signOut()` で行う。公開 export の削除は breaking なので次の major (v2.0.0) で行う

### Internal

- `createAuthGuard` の応答の変換を `toVerifyResult` に切り出し、cookie の読み取り関数の引数名を `readCookie` にした (外部 API は不変)
- build に使う TypeScript を 5.9.2 から 7.0.2 に上げた

## 1.1.0 — 2026-05-26

事業所 (company) 機能 (PR #55 → #63) を SDK 公開 API に反映。proto field 追加のみで wire 互換は維持 (`buf breaking` 通過)。

### Features

- `SessionData.companyId?: string` を追加。`createAuthGuard(...).getSession()` の戻り値で参照できる (未選択時 `undefined`)
- proto `Session.company_id` / `User.default_company_id` を unlock。`companyId` の source は `session.companyId ?? user.defaultCompanyId`
- magic-link rate limit / session revoke / dual-key 対応 (内部実装、公開 API 変更なし)

### Breaking changes

なし。`SessionData` への optional field 追加のみ (additive)。v1.0.x からの後方互換 minor bump。

proto contract を v1.0 として凍結し、`buf breaking` を CI で機械的に強制する。

### Stable

- proto `auth.v1.*` を v1.0 contract として凍結。以降の wire 互換性違反は CI (`buf breaking --against main`) で必ず block される
- v0.6.0 で導入した `VerifyResult` / `Result` enum / `SessionData.session.kind` / brand 型境界 を契約として確定
- consumer は v1.0.x をピン留めし、minor / patch では breaking が一切起きないことを期待してよい

### Process changes

- 今後 proto に breaking change を導入する場合、SDK の major 版を bump 必須 (例: v2.0.0)
- 並行運用が必要なら `docs/migration-strategy.md` の Dual Read/Write 戦略を参照
- minor / patch 版での proto 変更は backward-compatible なフィールド追加に限る (`buf breaking` が許容するもの)

### Breaking changes

なし (v0.6.0 で proto 形を確定済)。v1.0.0 は v0.6.x からの no-op bump。

## 0.6.0 — 2026-05-17

`user.revision` 整合 / `VerifyResult` oneof / SDK brand 型境界を導入。proto / SDK 型を最終形に揃え、v1.0 凍結前の最後の breaking 境界。

### Breaking changes

- `createAuthGuard(...).getSession()` の戻り型を `SessionData | null` → `VerifyResult` に変更
  - `VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result }`
  - consumer は `if (result.ok) { ... } else { ... }` で分岐
- `SessionData.session.kind: "user"` を新規追加 (現状は `"user"` 固定)
- proto `VerifySessionResponse` を `oneof outcome { ok | error }` に変更
- proto `User` に `int32 revision = 8` を追加
- proto `Session` に `string session_kind = 7` を追加
- proto `Result` enum を新規追加 (`OK` / `SESSION_NOT_FOUND` / `SESSION_EXPIRED` / `USER_DELETED` / `USER_LOCKED` / `REVOKED` / `REVISION_OUTDATED`)

### Features

- DB trigger による `user.revision` 自動 ++ (name / email / email_verified / image / account.password の変更で発火)
- `verifySession` で secondaryStorage (Redis) の `user.revision` と DB の最新値を比較し、不一致なら自動 `signOut` + `Result.REVISION_OUTDATED` を返す
- SDK 内部に `ExternalToken` / `InternalSession` brand 型を導入 (raw token を trusted として扱う path を compile-time block)

### 仕様補足

- account INSERT (OAuth 初回 link / credential 初回 sign-up) では `user.revision` は ++ しない。新規 user は `revision = 0` から開始するため不要
- IdP 自身の handler (`auth-entry-redirect.ts` / `avatar-upload.ts` / `login-shortcut.ts` の `isAuthenticated`) は `auth.api.getSession` 直叩きで stale session を許容してよい。revision 整合 check は consumer SDK の VerifySession 経由でのみ強制される
- `Result.UNSPECIFIED` は「token 不在 / RPC throw / outcome 想定外 / ok.value 欠落」の 4 経路の単一 fallback。consumer は再ログインに倒すこと (将来 `RESULT_TRANSPORT_ERROR` の追加を検討)
- `Result.SESSION_EXPIRED` / `USER_LOCKED` / `REVOKED` は現状到達不能。将来 `session.revoked_at` / user lock を実装した時点で活性化する
- proto `reserved 8 to 20` → `9 to 20` の reserved 解除は、0.5.x client が field 7/8 を空で送信する前提のため wire 互換性は保たれる
- 既存 Redis session (本 migration 初回 deploy 前に発行され revision フィールドを持たない) は handler が cache miss として整合判定を skip するため、deploy 瞬間の一斉ログアウト loop は発生しない
- `AUTH_SERVICE_KEY` 未設定 + `APP_ENV === "production"` の組合せでは process が起動拒否 (fail-fast)

### Migration example

```ts
// Before (v0.5.x)
const session = await guard.getSession();
if (!session) redirect("/auth/?...");
console.log(session.user.id);

// After (v0.6.0)
const result = await guard.getSession();
if (!result.ok) {
  if (result.reason === Result.REVISION_OUTDATED) {
    redirect(buildAuthLoginUrl({ /* ... */ hash: "revision_outdated" }));
  } else {
    redirect(buildAuthLoginUrl({ /* ... */ }));
  }
  return;
}
console.log(result.data.user.id);
```

## 0.5.0

- framework agnostic SDK 化 (docs/adr/0007-signin-signup-unified-api.md 系の境界整理)
- @taimei-code/auth-client へ scope rename + GitHub Packages publish
