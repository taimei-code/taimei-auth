import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? `${window.location.origin}/api/auth` : "",
});

export const useSelfUserId = (): string | null => authClient.useSession().data?.user.id ?? null;
