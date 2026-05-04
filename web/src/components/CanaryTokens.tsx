import { useEffect } from "react";

// 3 経路 canary token 埋込:
// (1) 不可視リンク: 画面外配置で DOM scraping bot が <a href> を辿る挙動を検出
// (2) hidden input: form 自動送信ボットが name="canary_token" を拾う挙動を検出
// (3) favicon URL: useEffect で <link rel="icon"> を動的注入、favicon prefetch 自動化を検出
//
// VITE_CANARY_TOKEN_ID env で制御 — 未設定なら何も埋込まない (開発環境のノイズ削減)。
// production / staging で固定値を設定する想定 (env-specific token id でフィッシングサイトを区別可能)。
const tokenId = import.meta.env.VITE_CANARY_TOKEN_ID as string | undefined;

export const CanaryTokens = () => {
  useEffect(() => {
    if (!tokenId) return;
    const link = document.createElement("link");
    link.rel = "icon";
    link.href = `/auth/canary-token/${tokenId}.ico`;
    link.type = "image/x-icon";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  if (!tokenId) return null;

  return (
    <>
      <a
        href={`/auth/canary-token/${tokenId}`}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute -left-[9999px] -top-[9999px]"
      >
        canary
      </a>
      <input
        type="hidden"
        name="canary_token"
        value={tokenId}
        aria-hidden="true"
      />
    </>
  );
};
