// better-auth が rotate した Set-Cookie を付け忘れると、成功直後にログアウトされる。
export function forwardSetCookie(response: Response, forwarded: Headers): Response {
  for (const cookie of forwarded.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
