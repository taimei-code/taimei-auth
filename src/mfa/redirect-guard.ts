import { getTrustedOrigins } from "../env";
import { Sentry } from "../sentry";

// チャレンジ成功時に返す遷移先の出口検証 (検証ポリシーの位置づけ: ADR-0003)。
// src/url-allowlist.ts の validateRedirectUrl を使えないのはチャレンジ介入点に service_name が
// 無いため — allowlist の軸を service でなく trusted origin に取る。

export const FALLBACK_REDIRECT = "/account";

type RejectionReason = "not_a_same_origin_path" | "origin_not_trusted";

// better-auth の trusted-origins 相対 path 検証 (1.6.23 matchesOriginPattern) と同一判定の regex。
// 公開 export が無いためハードコピー (文字クラス内のエスケープのみ linter が外し、判定は同値)。
// 素朴な「/ 始まりかつ // でない」では `/\evil.com` が \ → / 正規化で外部 origin に化ける。
const SAME_ORIGIN_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

// 出口は入口 (better-auth の trustedOrigins) より意図的に厳格で、origin の完全一致だけを通す。
// チャレンジ通過はセッション発行そのものなので解釈差を持ち込まない。wildcard 運用が始まったら再検討する。
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

// 拒否を silent にしない。「ログインはできるが元の画面に戻れない」の唯一の手掛かりがこの 1 件。
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
