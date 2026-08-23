// 招待受諾の着地 path+query。server (招待メールの callbackURL / 組立: src/handlers/account-invitation.ts)
// と SPA (SignIn / SignUp からの callbackUrl / 組立: web/src/auth/sign-params.ts) の双方が同じ形を
// 要求するため 1 箇所に置く (origin は runtime が違うため各側が付ける)。path か query キーを
// 片側だけ変えると、SignIn 経路か招待メール経路の一方だけが silent に脱落する (PR #116 の退行と同面)。
export const acceptInvitationPath = (invitationToken: string): string =>
  `/auth/signup/accept-invitation?invitation_token=${encodeURIComponent(invitationToken)}`;
