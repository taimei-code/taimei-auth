import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? `${window.location.origin}/api/auth` : "",
  plugins: [magicLinkClient()],
});

export const useSelfUserId = (): string | null => authClient.useSession().data?.user.id ?? null;
