import type { RedirectTarget } from "../sign-in-params";

// SPA と同じ形。片側だけ変えると相手が失敗を出さずに動かなくなる。
export const acceptInvitationPath = (invitationToken: string, target?: RedirectTarget): string => {
  // better-auth の magic-link verify は callbackURL を二重に decode するので、redirect_url の query と fragment は保たれない。
  const params = new URLSearchParams({ invitation_token: invitationToken, ...target });
  return `/auth/signup/accept-invitation?${params}`;
};
