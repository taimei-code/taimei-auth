import { type RedirectTarget, redirectTargetSchema } from "@core/sign-in-params";

export const parseRedirectTarget = (search: URLSearchParams): RedirectTarget | undefined => {
  const result = redirectTargetSchema.safeParse(Object.fromEntries(search));
  return result.success ? result.data : undefined;
};

export const redirectUrlAfterAccept = (search: URLSearchParams): string =>
  parseRedirectTarget(search)?.redirect_url ?? "/account";
