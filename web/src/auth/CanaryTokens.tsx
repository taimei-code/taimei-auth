import { useEffect } from "react";

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
      {/* oxlint-disable-next-line jsx-a11y/no-aria-hidden-on-focusable -- type=hidden の input は focus を受けない */}
      <input type="hidden" name="canary_token" value={tokenId} aria-hidden="true" />
    </>
  );
};
