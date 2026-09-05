// MFA 操作は better-auth がセッションを rotate するため、use-case が返した Set-Cookie を載せ忘れると
// 本人が成功直後にログアウトする。Set-Cookie は複数値 header のため set でなく append で積む (上書きすると
// better-auth が返した session cookie と cookieCache のどちらかが落ちる)。
export function forwardSetCookie(response: Response, forwarded: Headers): Response {
  for (const cookie of forwarded.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
