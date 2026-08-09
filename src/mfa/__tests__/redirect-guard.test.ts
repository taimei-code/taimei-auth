import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { setSentryBackend, type CaptureContext } from "../../sentry";
import { FALLBACK_REDIRECT, validateChallengeRedirect } from "../redirect-guard";
import maliciousUrlsRaw from "./fixtures/malicious-callback-urls.json";

type CallbackUrlCase = { name: string; url: string; expected: boolean };
const callbackUrlCases = maliciousUrlsRaw as CallbackUrlCase[];

type Captured = { message: string; context?: CaptureContext };

let captured: Captured[] = [];

const spyBackend = {
  captureException: () => {},
  captureMessage: (message: string, context?: CaptureContext) => {
    captured.push({ message, context });
  },
};

// Sentry backend も AUTH_TRUSTED_ORIGINS も module-global で、戻し忘れは後続 test file に漏れる。
const consoleFallback = {
  captureException: (error: unknown) => console.error("[sentry:noop] captureException", error),
  captureMessage: (message: string, context?: CaptureContext) =>
    console.warn("[sentry:noop] captureMessage", message, context?.tags),
};

const originalTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS;

const TRUSTED_ORIGINS = "https://app.taimei-code.com,https://auth.taimei-code.com";

const rejectionReasons = (): (string | undefined)[] => captured.map((c) => c.context?.tags?.reason);

describe("validateChallengeRedirect", () => {
  beforeEach(() => {
    captured = [];
    setSentryBackend(spyBackend);
    process.env.AUTH_TRUSTED_ORIGINS = TRUSTED_ORIGINS;
  });

  afterAll(() => {
    setSentryBackend(consoleFallback);
    if (originalTrustedOrigins === undefined) delete process.env.AUTH_TRUSTED_ORIGINS;
    else process.env.AUTH_TRUSTED_ORIGINS = originalTrustedOrigins;
  });

  test("QA-H-06 trusted origin 絶対 URL は同一文字列でそのまま返る", () => {
    const consumerCallback = "https://app.taimei-code.com/dashboard?tab=1";
    expect(validateChallengeRedirect(consumerCallback)).toBe(consumerCallback);
    expect(captured).toHaveLength(0);
  });

  test("QA-H-07 招待受諾動線が /account に転落しない", () => {
    const invitationCallback = "/auth/signup/company?invitation_token=abcDEF-123";
    expect(validateChallengeRedirect(invitationCallback)).toBe(invitationCallback);
    expect(captured).toHaveLength(0);
  });

  test("QA-E-07 trusted 外 origin は /account へ倒し Sentry に 1 件だけ載せる", () => {
    expect(validateChallengeRedirect("https://evil.com/steal")).toBe(FALLBACK_REDIRECT);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.message).toBe("mfa: challenge redirect rejected");
    expect(captured[0]?.context?.level).toBe("warning");
    expect(captured[0]?.context?.tags).toEqual({
      component: "mfa-redirect-guard",
      reason: "origin_not_trusted",
    });
    expect(captured[0]?.context?.extra).toEqual({ rejected: "https://evil.com/steal" });
  });

  test.each(callbackUrlCases)("QA-E-08 $name", ({ url, expected }: CallbackUrlCase) => {
    expect(validateChallengeRedirect(url)).toBe(expected ? url : FALLBACK_REDIRECT);
    expect(captured).toHaveLength(expected ? 0 : 1);
  });

  test("QA-D-05 callbackURL 未指定/空は /account へ倒し Sentry には載せない", () => {
    expect(validateChallengeRedirect(undefined)).toBe(FALLBACK_REDIRECT);
    expect(validateChallengeRedirect("")).toBe(FALLBACK_REDIRECT);
    expect(captured).toHaveLength(0);
  });

  test("QA-M-12 wildcard trusted origin は出口では展開されず配下 origin も /account へ倒れる", () => {
    process.env.AUTH_TRUSTED_ORIGINS = "https://*.taimei-code.com";

    expect(validateChallengeRedirect("https://app.taimei-code.com/dashboard")).toBe(
      FALLBACK_REDIRECT,
    );
    expect(rejectionReasons()).toEqual(["origin_not_trusted"]);
  });

  test("QA-M-12 wildcard entry を並べても相対 path は入口/出口で一致したまま通る", () => {
    process.env.AUTH_TRUSTED_ORIGINS = "https://*.taimei-code.com";

    expect(validateChallengeRedirect("/account/security")).toBe("/account/security");
    expect(captured).toHaveLength(0);
  });

  test("QA-M-20 fragment 付きは相対 path も絶対 URL も拒否して /account へ倒す", () => {
    expect(validateChallengeRedirect("/account?next=%2F&x=1#frag")).toBe(FALLBACK_REDIRECT);
    expect(validateChallengeRedirect("https://app.taimei-code.com/dashboard#frag")).toBe(
      FALLBACK_REDIRECT,
    );
    expect(rejectionReasons()).toEqual(["not_a_same_origin_path", "origin_not_trusted"]);
  });
});
