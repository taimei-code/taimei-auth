// MFA 操作は better-auth がセッションを rotate するため、use-case が返した Set-Cookie を載せ忘れると
// 本人が成功直後にログアウトする。積み方 (append) の理由は src/mfa/session-headers.ts。
export function forwardSetCookie(response: Response, forwarded: Headers): Response {
  for (const cookie of forwarded.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
