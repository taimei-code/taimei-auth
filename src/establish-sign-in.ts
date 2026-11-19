import { Effect } from "effect";
import { appendAuditBestEffort, type SignInMethod, signInEntry } from "./audit/append";
import { AuthApi } from "./auth-service";
import { validateSignInRedirect } from "./sign-in-redirect";

export const establishSignIn = Effect.fnUntraced(function* (
  headers: Headers,
  signIn: { userId: string; method: SignInMethod; redirectUrl: string | undefined },
) {
  const sessionHeaders = yield* AuthApi.use((authApi) => authApi.issueSession(signIn.userId));
  yield* appendAuditBestEffort(signInEntry(signIn.userId, signIn.method, headers));
  return {
    redirectUrl: yield* validateSignInRedirect(signIn.redirectUrl),
    forwardedHeaders: sessionHeaders,
  };
});
