import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { Effect } from "effect";
import { SentryLive } from "../../sentry";
import { recordSentry } from "../../__tests__/sentry-recorder";
import { FALLBACK_REDIRECT, validateChallengeRedirect as validateEffect } from "../redirect-guard";
import maliciousUrlsRaw from "./fixtures/malicious-callback-urls.json";

type CallbackUrlCase = { name: string; url: string; expected: boolean };
const callbackUrlCases = maliciousUrlsRaw as CallbackUrlCase[];

const sentry = recordSentry();
const captured = sentry.messages;

const validateChallengeRedirect = (raw: string | undefined): string =>
  Effect.runSync(Effect.provide(validateEffect(raw), SentryLive));

const originalTrustedOrigins = process.env.AUTH_TRUSTED_ORIGINS;

const TRUSTED_ORIGINS = "https://app.taimei-code.com,https://auth.taimei-code.com";

const rejectionReasons = (): (string | undefined)[] => captured.map((c) => c.context?.tags?.reason);

describe("validateChallengeRedirect", () => {
  beforeEach(() => {
    sentry.reset();
    process.env.AUTH_TRUSTED_ORIGINS = TRUSTED_ORIGINS;
  });

  afterAll(() => {
    if (originalTrustedOrigins === undefined) delete process.env.AUTH_TRUSTED_ORIGINS;
    else process.env.AUTH_TRUSTED_ORIGINS = originalTrustedOrigins;
  });

  test("trusted origin の絶対 URL は同じ文字列のまま返す", () => {
    const consumerCallback = "https://app.taimei-code.com/dashboard?tab=1";
    expect(validateChallengeRedirect(consumerCallback)).toBe(consumerCallback);
    expect(captured).toHaveLength(0);
  });

  test("招待の受諾の path は /account に置き換えずにそのまま返す", () => {
    const invitationCallback = "/auth/signup/company?invitation_token=abcDEF-123";
    expect(validateChallengeRedirect(invitationCallback)).toBe(invitationCallback);
    expect(captured).toHaveLength(0);
  });

  test("trusted 外の origin は /account に置き換え、Sentry に 1 件だけ記録する", () => {
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

  test.each(callbackUrlCases)("callbackURL は正規のものを通し、不正なものを置き換える: $name", ({
    url,
    expected,
  }: CallbackUrlCase) => {
    expect(validateChallengeRedirect(url)).toBe(expected ? url : FALLBACK_REDIRECT);
    expect(captured).toHaveLength(expected ? 0 : 1);
  });

  test("callbackURL が未指定か空なら /account を返し、Sentry には記録しない", () => {
    expect(validateChallengeRedirect(undefined)).toBe(FALLBACK_REDIRECT);
    expect(validateChallengeRedirect("")).toBe(FALLBACK_REDIRECT);
    expect(captured).toHaveLength(0);
  });

  test("wildcard の trusted origin は通過の後の検証では展開せず、配下の origin も /account に置き換える", () => {
    process.env.AUTH_TRUSTED_ORIGINS = "https://*.taimei-code.com";

    expect(validateChallengeRedirect("https://app.taimei-code.com/dashboard")).toBe(
      FALLBACK_REDIRECT,
    );
    expect(rejectionReasons()).toEqual(["origin_not_trusted"]);
  });

  test("wildcard の entry を並べても、相対 path は入口と通過の後の検証で同じ判定のまま通る", () => {
    process.env.AUTH_TRUSTED_ORIGINS = "https://*.taimei-code.com";

    expect(validateChallengeRedirect("/account/security")).toBe("/account/security");
    expect(captured).toHaveLength(0);
  });

  test("fragment 付きは相対 path も絶対 URL も拒否して /account に置き換える", () => {
    expect(validateChallengeRedirect("/account?next=%2F&x=1#frag")).toBe(FALLBACK_REDIRECT);
    expect(validateChallengeRedirect("https://app.taimei-code.com/dashboard#frag")).toBe(
      FALLBACK_REDIRECT,
    );
    expect(rejectionReasons()).toEqual(["not_a_same_origin_path", "origin_not_trusted"]);
  });
});

describe("guard が通す相対 path は、better-auth の callbackURL の判定も通す", () => {
  test("fixture のどの相対 path でも成り立つ (better-auth は判定の関数を公開しないので、guard は better-auth より狭い判定を自分で持つ)", async () => {
    const reference = betterAuth({
      baseURL: "https://auth.taimei-code.com",
      secret: "redirect-guard-reference-secret-0123456789",
      trustedOrigins: TRUSTED_ORIGINS.split(","),
    });
    const context = await reference.$context;
    const relativeCases = callbackUrlCases.filter(({ url }) => url.startsWith("/"));
    expect(relativeCases.length).toBeGreaterThan(5);

    const passedOnlyByGuard = relativeCases.filter(
      ({ url }) =>
        validateChallengeRedirect(url) === url &&
        !context.isTrustedOrigin(url, { allowRelativePaths: true }),
    );

    expect(passedOnlyByGuard.map(({ name }) => name)).toEqual([]);
  });
});
