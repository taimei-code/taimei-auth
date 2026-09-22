import { Effect } from "effect";
import { getTrustedOrigins } from "../env";
import { SentryService } from "../sentry";

export const FALLBACK_REDIRECT = "/account";

type RejectionReason = "not_a_same_origin_path" | "origin_not_trusted";

// better-auth 1.6.23 の matchesOriginPattern と同じ (公開 export が無い)。`/` 始まりだけの判定では `/\evil.com` が別 origin になる。
const SAME_ORIGIN_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

// 入口 (trustedOrigins) の pattern 一致より厳しく、origin 完全一致だけを通す。
function isTrustedAbsoluteUrl(candidate: string): boolean {
  const url = parseUrl(candidate);
  if (!url) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  // 相対パス側の regex (`$` 終端) と揃えて fragment を拒否する。
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

const fallBackAndReport = Effect.fn("mfa.rejectChallengeRedirect")(function* (
  rejected: string,
  reason: RejectionReason,
) {
  const sentry = yield* SentryService;
  yield* sentry.captureMessage("mfa: challenge redirect rejected", {
    level: "warning",
    tags: { component: "mfa-redirect-guard", reason },
    extra: { rejected },
  });
  return FALLBACK_REDIRECT;
});

export const validateChallengeRedirect = Effect.fn("mfa.validateChallengeRedirect")(function* (
  raw: string | undefined,
) {
  if (!raw) return FALLBACK_REDIRECT;
  if (raw.startsWith("/")) {
    return SAME_ORIGIN_PATH.test(raw)
      ? raw
      : yield* fallBackAndReport(raw, "not_a_same_origin_path");
  }
  return isTrustedAbsoluteUrl(raw) ? raw : yield* fallBackAndReport(raw, "origin_not_trusted");
});
