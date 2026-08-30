import type { ChallengeMethod } from "../mfa/totp/login-challenge";

// better-auth の hook が受け取る `ctx.path` は route パターンで実 path ではない (OAuth callback は常に
// "/callback/:id")。移設前の sign_in 写像は "/callback/github" 前置一致で 2 分岐とも空振りしていた。
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

// provider id は外部入力。index lookup は prototype chain 経由で未知 provider を通すため hasOwn で足切りする。
const CHALLENGE_METHOD_BY_PROVIDER: Record<string, ChallengeMethod> = {
  github: "github",
};

// 未知の route / provider で既定値に寄せないのは、provider 追加時に誤った method の sign_in audit が黙って
// 積まれるため。undefined を返し呼び出し側を「チャレンジは fail-closed、audit は記帳しない」へ倒す。
export function resolvePrimaryAuthMethod(route: AuthRouteMatch): ChallengeMethod | undefined {
  if (route.path === MAGIC_LINK_VERIFY_ROUTE) return "magic_link";
  if (route.path !== OAUTH_CALLBACK_ROUTE) return undefined;

  const provider = route.params?.id;
  if (!provider || !Object.hasOwn(CHALLENGE_METHOD_BY_PROVIDER, provider)) return undefined;
  return CHALLENGE_METHOD_BY_PROVIDER[provider];
}
