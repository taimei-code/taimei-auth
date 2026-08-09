import type { ChallengeMethod } from "../mfa/challenge-store";

// better-auth の hook が受け取る `ctx.path` は **route パターン**で、ブラウザが叩いた実 path では
// ない (dispatchAuthEndpoint が `path: endpoint.path` を詰める)。GitHub OAuth の callback は常に
// "/callback/:id" として観測され "/callback/github" とは一致しない。移設前の sign_in 写像は
// "/callback/github" への前置一致を見ており、magic link 側と合わせて 2 分岐とも空振りしていた。
export const MAGIC_LINK_VERIFY_ROUTE = "/magic-link/verify";
export const OAUTH_CALLBACK_ROUTE = "/callback/:id";

export const PRIMARY_AUTH_ROUTES = [MAGIC_LINK_VERIFY_ROUTE, OAUTH_CALLBACK_ROUTE] as const;

export type AuthRouteMatch = {
  path: string | undefined;
  params: Record<string, string> | undefined;
};

export function isPrimaryAuthRoute(path: string | undefined): boolean {
  return PRIMARY_AUTH_ROUTES.some((route) => route === path);
}

// provider id は URL segment 由来の外部入力。plain object の index lookup では "toString" 等が
// prototype chain から引けて未知 provider が既知扱いで通るため、hasOwn で足切りしてから引く。
const CHALLENGE_METHOD_BY_PROVIDER: Record<string, ChallengeMethod> = {
  github: "github",
};

// 未知の route / provider で既定値 ("github" 等) に寄せないのは、provider 追加時に誤った method の
// sign_in audit event が黙って積まれるため。undefined を返し、呼び出し側を
// 「チャレンジは fail-closed、audit は記帳しない」へ倒す。
export function resolvePrimaryAuthMethod(route: AuthRouteMatch): ChallengeMethod | undefined {
  if (route.path === MAGIC_LINK_VERIFY_ROUTE) return "magic_link";
  if (route.path !== OAUTH_CALLBACK_ROUTE) return undefined;

  const provider = route.params?.id;
  if (!provider || !Object.hasOwn(CHALLENGE_METHOD_BY_PROVIDER, provider)) return undefined;
  return CHALLENGE_METHOD_BY_PROVIDER[provider];
}
