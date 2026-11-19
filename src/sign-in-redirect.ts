import { Effect } from "effect";
import { getTrustedOrigins } from "./env";
import { SentryService } from "./sentry";

export const FALLBACK_REDIRECT = "/account";

type RejectionReason = "not_a_same_origin_path" | "origin_not_trusted";

const SAME_ORIGIN_PATH = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/;

function isTrustedAbsoluteUrl(candidate: string): boolean {
  const url = parseUrl(candidate);
  if (!url) return false;
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
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

const fallBackAndReport = Effect.fnUntraced(function* (rejected: string, reason: RejectionReason) {
  const sentry = yield* SentryService;
  yield* sentry.captureMessage("sign-in: redirect rejected", {
    level: "warning",
    tags: { component: "sign-in-redirect-guard", reason },
    extra: { rejected },
  });
  return FALLBACK_REDIRECT;
});

export const validateSignInRedirect = Effect.fnUntraced(function* (raw: string | undefined) {
  if (!raw) return FALLBACK_REDIRECT;
  if (raw.startsWith("/")) {
    return SAME_ORIGIN_PATH.test(raw)
      ? raw
      : yield* fallBackAndReport(raw, "not_a_same_origin_path");
  }
  return isTrustedAbsoluteUrl(raw) ? raw : yield* fallBackAndReport(raw, "origin_not_trusted");
});
