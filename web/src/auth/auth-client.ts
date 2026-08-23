import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// better-auth browser client の唯一の生成点。
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? `${window.location.origin}/api/auth` : "",
  plugins: [magicLinkClient()],
});
