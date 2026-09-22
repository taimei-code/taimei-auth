import type { ChallengeMethod } from "../mfa/totp/login-challenge";

// better-auth の hook が受け取る `ctx.path` は実際のパスではなく route パターンである ("/callback/:id" など)。
const MAGIC_LINK_VERIFY_ROUTE = "/magic-link/verify";
const OAUTH_CALLBACK_ROUTE = "/callback/:id";

export const PRIMARY_AUTH_ROUTES = [MAGIC_LINK_VERIFY_ROUTE, OAUTH_CALLBACK_ROUTE] as const;

export type UnmappedRoute = {
  readonly _tag: "Unmapped";
  readonly path: string;
  readonly providerId: string | undefined;
};

export type PrimaryAuthRoute =
  | { readonly _tag: "Mapped"; readonly method: ChallengeMethod }
  | UnmappedRoute;

export function isPrimaryAuthRoute(path: string | undefined): boolean {
  return PRIMARY_AUTH_ROUTES.some((route) => route === path);
}

export function parsePrimaryAuthRoute(
  path: string,
  params: Record<string, unknown> | undefined,
): PrimaryAuthRoute {
  if (path === MAGIC_LINK_VERIFY_ROUTE) return { _tag: "Mapped", method: "magic_link" };
  if (path === OAUTH_CALLBACK_ROUTE && params?.id === "github")
    return { _tag: "Mapped", method: "github" };
  return {
    _tag: "Unmapped",
    path,
    providerId: typeof params?.id === "string" ? params.id : undefined,
  };
}
