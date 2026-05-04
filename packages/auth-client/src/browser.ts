/**
 * ブラウザ用 Better Auth クライアント
 *
 * プロダクト側で baseURL を auth-service に向けるだけで利用可能。
 * signIn, signOut, useSession 等は Better Auth のネイティブ API をそのまま使用。
 *
 * 使用例:
 *   import { createBrowserAuthClient } from "@taimei-code/auth-client/browser";
 *   const authClient = createBrowserAuthClient({ baseURL: "https://auth.taimei-code.com" });
 *   const { signIn, signOut, useSession } = authClient;
 */

export type BrowserAuthClientOptions = {
  baseURL: string;
};

// Better Auth の createAuthClient を再エクスポートするだけ
// プロダクト側が better-auth/react を直接インポートする形を維持
// （SDK で薄くラップしすぎると、Better Auth のバージョンアップ追従が困難になるため）
export function createBrowserAuthClient(options: BrowserAuthClientOptions) {
  return {
    baseURL: options.baseURL,
  };
}
