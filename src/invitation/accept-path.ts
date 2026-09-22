// server と SPA が同じ形を要求する。片側だけ変えると、もう一方が失敗を出さないまま動かなくなる (PR #116 の退行と同じ構図)。
export const acceptInvitationPath = (invitationToken: string): string =>
  `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent(invitationToken)}`;
