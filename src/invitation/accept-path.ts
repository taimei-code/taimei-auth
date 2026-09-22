// SPA と同じ形。片側だけ変えると相手が失敗を出さずに動かなくなる。
export const acceptInvitationPath = (invitationToken: string): string =>
  `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent(invitationToken)}`;
