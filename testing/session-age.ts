import { Effect } from "effect";
import { AuthApi } from "../src/auth-service";
import { Forbidden } from "../src/failures";
import { betterAuthKey } from "../src/ttl-key";
import { TtlStore } from "../src/ttl-store-service";

export const backdateSignedInSession = Effect.fnUntraced(function* (
  headers: Headers,
  issuedSecondsAgo: number,
) {
  const signedIn = yield* AuthApi.use((authApi) => authApi.getSession(headers));
  const key = signedIn === null ? null : betterAuthKey(signedIn.session.token);
  if (key === null) return yield* new Forbidden();
  const ttlStore = yield* TtlStore;
  const stored = JSON.parse((yield* ttlStore.get(key)) ?? "null");
  const now = Date.now();
  stored.session.createdAt = new Date(now - issuedSecondsAgo * 1000).toISOString();
  const remainingSeconds = Math.ceil((new Date(stored.session.expiresAt).getTime() - now) / 1000);
  yield* ttlStore.set(key, JSON.stringify(stored), remainingSeconds);
});
