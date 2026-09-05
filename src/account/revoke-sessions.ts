import { Effect } from "effect";
import type { DbTx } from "@/db/transaction";
import { AuthApi } from "../auth-service";
import { SessionRepo } from "./ports";

// アカウント削除経路の session 失効の唯一の窓口。better-auth は secondaryStorage 構成で session 実体を
// Redis のみに置くため、DB の revoked_at 記帳だけでは失効せず、削除済み user の cookie が認証を通り続けて
// membership insert の FK 違反 500 に至った実障害がある。Redis 削除は tx rollback に追随しないが、この順序
// なら「user 残存 + 全 session ログアウト」= fail-closed に倒れる (逆順は「user 消滅 + session 生存」の穴)。
export const revokeUserSessions = Effect.fn("account.revokeUserSessions")(function* (
  userId: string,
  tx: DbTx,
) {
  const sessions = yield* SessionRepo;
  const authApi = yield* AuthApi;
  yield* sessions.revokeAllSessionsForUser(userId, tx);
  yield* authApi.deleteUserSessions(userId);
});
