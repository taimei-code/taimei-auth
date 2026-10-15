import { authClient } from "./auth-client";

export type SignOutResult = "signedOut" | "failed";

export const SIGN_OUT_FAILED = "ログアウトに失敗しました。しばらくしてから再度お試しください。";

export const signOut = (
  request: () => Promise<{ readonly error: unknown }> = () => authClient.signOut(),
): Promise<SignOutResult> =>
  request().then(
    ({ error }) => (error ? "failed" : "signedOut"),
    () => "failed",
  );
