import { getTrustedOrigins } from "../env";
import { Sentry } from "../sentry";

// チャレンジ成功時に返す遷移先の出口検証。
//
// src/url-allowlist.ts の validateRedirectUrl を使えないのは、チャレンジ介入点に service_name が
// 存在しないため (magic link verify / OAuth callback のクエリにも SendMagicLink RPC にも
// service の概念が無い)。よって allowlist の軸を service でなく trusted origin に取る。
// 検証ポリシーの位置づけ: docs/adr/0003-redirect-url-allowlist-policy.md

export const FALLBACK_REDIRECT = "/account";

type RejectionReason = "not_a_same_origin_path" | "origin_not_trusted";

// better-auth の trusted-origins 相対 path 検証 (dist/auth/trusted-origins.mjs の
// matchesOriginPattern、better-auth 1.6.23) と同一判定の regex。公開 export が無いため
// ハードコピーしている。文字クラス内の不要なエスケープだけ linter が外しており判定は同値。
// 素朴な「/ 始まりかつ // でない」では不足する — `/\evil.com` がブラウザの \ → / 正規化で
// 外部 origin に化ける。`$` 終端により fragment 付きも弾く。
const SAME_ORIGIN_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

// 出口は入口 (better-auth の trustedOrigins) より意図的に厳格にしている。エントリ側は
// wildcard / path 付きパターンを許すが、ここは origin の完全一致だけを通す。チャレンジ通過は
// セッション発行そのものなので、パターン照合の解釈差を出口に持ち込まない判断。
// AUTH_TRUSTED_ORIGINS に wildcard を実際に入れる運用が始まったらこの判断を再検討すること。
function isTrustedAbsoluteUrl(candidate: string): boolean {
  const url = parseUrl(candidate);
  if (!url) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  // fragment 付きは拒否する (相対 path 側の regex が `$` 終端で弾くのと挙動を揃える)。
  if (url.hash !== "") return false;
  return getTrustedOrigins().some((entry) => parseUrl(entry)?.origin === url.origin);
}

function parseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

// 拒否は silent に握り潰さない。ここで落ちると「ログインはできるが元の画面に戻れない」という
// ユーザーからは原因不明の症状になり、Sentry のこの 1 件が唯一の手掛かりになる。
function fallBackAndReport(rejected: string, reason: RejectionReason): string {
  Sentry.captureMessage("mfa: challenge redirect rejected", {
    level: "warning",
    tags: { component: "mfa-redirect-guard", reason },
    extra: { rejected },
  });
  return FALLBACK_REDIRECT;
}

export function validateChallengeRedirect(raw: string | undefined): string {
  if (!raw) return FALLBACK_REDIRECT;
  if (raw.startsWith("/")) {
    return SAME_ORIGIN_PATH.test(raw) ? raw : fallBackAndReport(raw, "not_a_same_origin_path");
  }
  return isTrustedAbsoluteUrl(raw) ? raw : fallBackAndReport(raw, "origin_not_trusted");
}
