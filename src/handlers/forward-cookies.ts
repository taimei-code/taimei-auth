// MFA の有効化・無効化・チャレンジ通過は better-auth 側でセッションを rotate するため、use-case が
// 返した Set-Cookie を載せ忘れるとブラウザが削除済み session の cookie を持ち続け、操作した本人が
// 成功直後にログアウトする。積み方 (append) の理由は src/mfa/session-headers.ts の mergeForwardedCookies。
export function forwardSetCookie(response: Response, forwarded: Headers): Response {
  for (const cookie of forwarded.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
