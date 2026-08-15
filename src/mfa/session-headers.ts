// 複数の gateway 呼び出しが返す Set-Cookie を入力順に束ねる。後段の session rotate で
// 前段の cookie を失わないよう、同名 cookie も上書きせず append する。
export function mergeForwardedCookies(...sources: Headers[]): Headers {
  const merged = new Headers();
  for (const source of sources) {
    for (const cookie of source.getSetCookie()) merged.append("set-cookie", cookie);
  }
  return merged;
}
