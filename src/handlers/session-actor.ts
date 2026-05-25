import { auth } from "../auth";

// SPA 向け Hono ルートで session cookie から actor を解決する共通ヘルパー。
// getSession 失敗 (cookie 不正 / Redis 一時断 / 設定ミス) は null に倒し呼び出し側で 401 にする
// = auth は fail-closed が安全 (誤って通すより拒否する)。
export async function getSessionActorId(headers: Headers): Promise<string | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null);
  return session?.user?.id ?? null;
}

export async function getSessionActor(
  headers: Headers,
): Promise<{ id: string; email: string } | null> {
  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session?.user?.id) return null;
  return { id: session.user.id, email: session.user.email };
}
