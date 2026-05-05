import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Layer B (auth.taimei-code.com/auth/*) で使う Better Auth client。
// プロダクト側 (taimei) が使う @taimei-code/auth-client/browser とは別 — 同サーバー内 Layer B は
// /api/auth ルートに同オリジンでアクセスできるので Better Auth の native client を直接使う。
// Better Auth 1.5+ は baseURL に絶対 URL を要求するため window.location.origin を前置。
// SPA は client-only 実行のため SSR 時の window 不在は考慮不要だが、 typeof guard でビルド時の
// 静的解析もクリアする。
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? `${window.location.origin}/api/auth` : "",
  plugins: [magicLinkClient()],
});
