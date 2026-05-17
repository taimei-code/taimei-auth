# Changelog

## 1.0.0 — 2026-05-17

ADR-001 Phase 2 完了。proto contract を v1.0 として凍結し、`buf breaking` を CI で機械的に強制する。

### Stable

- proto `auth.v1.*` を v1.0 contract として凍結。以降の wire 互換性違反は CI (`buf breaking --against main`) で必ず block される
- v0.6.0 で導入した `VerifyResult` / `Result` enum / `SessionData.session.kind` / brand 型境界 を契約として確定
- consumer は v1.0.x をピン留めし、minor / patch では breaking が一切起きないことを期待してよい

### Process changes

- 今後 proto に breaking change を導入する場合、SDK の major 版を bump 必須 (例: v2.0.0)
- 並行運用が必要なら ADR-002 Phase 3 で Dual Read/Write を検討 (`docs/migration-strategy.md` 参照)
- minor / patch 版での proto 変更は backward-compatible なフィールド追加に限る (`buf breaking` が許容するもの)

### Breaking changes

なし (v0.6.0 で proto 形を確定済)。v1.0.0 は v0.6.x からの no-op bump。

## 0.6.0 — 2026-05-17

ADR-001 Phase 1.5 + R5 実装。proto / SDK 型を最終形に揃え、v1.0 凍結前の最後の breaking 境界。

### Breaking changes

- `createAuthGuard(...).getSession()` の戻り型を `SessionData | null` → `VerifyResult` に変更
  - `VerifyResult = { ok: true; data: SessionData } | { ok: false; reason: Result }`
  - consumer は `if (result.ok) { ... } else { ... }` で分岐
- `SessionData.session.kind: "user"` を新規追加 (ADR-001 R7、現状は `"user"` 固定)
- proto `VerifySessionResponse` を `oneof outcome { ok | error }` に変更 (ADR-001 R2)
- proto `User` に `int32 revision = 8` を追加 (ADR-001 R1)
- proto `Session` に `string session_kind = 7` を追加 (ADR-001 R7)
- proto `Result` enum を新規追加 (`OK` / `SESSION_NOT_FOUND` / `SESSION_EXPIRED` / `USER_DELETED` / `USER_LOCKED` / `REVOKED` / `REVISION_OUTDATED`)

### Features

- DB trigger による `user.revision` 自動 ++ (name / email / email_verified / image / account.password の変更で発火)
- `verifySession` で secondaryStorage (Redis) の `user.revision` と DB の最新値を比較し、不一致なら自動 `signOut` + `Result.REVISION_OUTDATED` を返す
- SDK 内部に `ExternalToken` / `InternalSession` brand 型を導入 (raw token を trusted として扱う path を compile-time block、ADR-001 R5)

### 仕様補足 (MECE 由来)

- account INSERT (OAuth 初回 link / credential 初回 sign-up) では `user.revision` は ++ しない。新規 user は `revision = 0` から開始するため不要 (MECE I4)
- IdP 自身の handler (`auth-entry-redirect.ts` / `avatar-upload.ts` / `login-shortcut.ts` の `isAuthenticated`) は `auth.api.getSession` 直叩きで stale session を許容してよい。revision 整合 check は consumer SDK の VerifySession 経由でのみ強制される (MECE I5)
- `Result.UNSPECIFIED` は「token 不在 / RPC throw / outcome 想定外 / ok.value 欠落」の 4 経路の単一 fallback。consumer は再ログインに倒すこと (Phase 2 で `RESULT_TRANSPORT_ERROR` 追加を検討、MECE I6)
- `Result.SESSION_EXPIRED` / `USER_LOCKED` / `REVOKED` は現状到達不能。Phase 3 で `session.revoked_at` / user lock 実装時に活性化する (MECE N1)
- proto `reserved 8 to 20` → `9 to 20` の reserved 解除は、0.5.x client が field 7/8 を空で送信する前提のため wire 互換性は保たれる (MECE N5)
- 既存 Redis session (PR-A デプロイ前に発行され revision フィールドを持たない) は handler が cache miss として整合判定を skip するため、deploy 瞬間の一斉ログアウト loop は発生しない (MECE C1)
- `AUTH_SERVICE_KEY` 未設定 + `APP_ENV === "production"` の組合せでは process が起動拒否 (fail-fast、MECE C4)

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

- ADR-007: framework agnostic SDK 化
- @taimei-code/auth-client へ scope rename + GitHub Packages publish
