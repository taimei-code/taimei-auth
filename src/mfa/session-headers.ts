// 複数 gateway 呼び出しの Set-Cookie を入力順に束ねる。後段 rotate で前段を失わないよう同名も append する。
export function mergeForwardedCookies(...sources: Headers[]): Headers {
  const merged = new Headers();
  for (const source of sources) {
    for (const cookie of source.getSetCookie()) merged.append("set-cookie", cookie);
  }
  return merged;
}
