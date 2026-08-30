// 招待受諾の着地 path+query。server (招待メールの callbackURL) と SPA (SignIn / SignUp の callbackUrl) が
// 同じ形を要求するため 1 箇所に置く。片側だけ変えると一方の経路が silent に脱落する (PR #116 の退行と同面)。
export const acceptInvitationPath = (invitationToken: string): string =>
  `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent(invitationToken)}`;
