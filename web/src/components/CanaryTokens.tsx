import { useEffect } from "react";

// 3 経路 (不可視リンク / hidden input / favicon) で canary token を埋込む。詳細: docs/adr/0005-canary-token-embedding.md
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
      {/* biome-ignore lint/a11y/useAnchorContent: scraper 検知用のおとりリンク。実利用者 (スクリーンリーダー含む) から隠すのが仕様 (docs/adr/0005-canary-token-embedding.md) */}
      <a
        href={`/auth/canary-token/${tokenId}`}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute -left-[9999px] -top-[9999px]"
      >
        canary
      </a>
      <input type="hidden" name="canary_token" value={tokenId} aria-hidden="true" />
    </>
  );
};
