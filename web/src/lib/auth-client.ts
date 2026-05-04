import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Layer B (auth.taimei-code.com/auth/*) で使う Better Auth client。
// プロダクト側 (taimei) が使う @taimei-code/auth-client/browser とは別 — 同サーバー内 Layer B は
// /api/auth ルートに同オリジンでアクセスできるので Better Auth の native client を直接使う。
// baseURL は相対 path のため env 設定不要。
export const authClient = createAuthClient({
  baseURL: "/api/auth",
  plugins: [magicLinkClient()],
});
