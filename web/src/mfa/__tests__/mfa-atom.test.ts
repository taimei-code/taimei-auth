import { describe, expect, test } from "bun:test";
import { Cause, Exit } from "effect";
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http";

import { Unauthorized } from "@core/membership/guard/errors";
import { EnrollmentChanged, InvalidCode, Locked } from "@core/mfa/error-mapping";

import { mfaChallengeObservationOf, mfaErrorCodeOfCause } from "../mfa-atom";

const statusError = (status: number) => {
  const request = HttpClientRequest.post("/api/account/mfa/disable");
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.StatusCodeError({
      request,
      response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
    }),
  });
};

describe("mfaErrorCodeOfCause", () => {
  test("429 の境界: 宣言した Locked は locked、tag の無い 429 (Hono の rate limit) は rate_limited", () => {
    expect(mfaErrorCodeOfCause(Cause.fail(new Locked()))).toBe("locked");
    expect(mfaErrorCodeOfCause(Cause.die(statusError(429)))).toBe("rate_limited");
  });

  test.each([
    ["InvalidCode", Cause.fail(new InvalidCode()), "invalid_code"],
    ["EnrollmentChanged", Cause.fail(new EnrollmentChanged()), "enrollment_changed"],
    ["Unauthorized", Cause.fail(new Unauthorized()), "unauthorized"],
    ["500 の HttpClientError", Cause.die(statusError(500)), "unknown"],
    ["Error", Cause.die(new Error("network")), "unknown"],
  ] as const)("%s は %s", (_name, cause, expected) => {
    expect(mfaErrorCodeOfCause(cause)).toBe(expected);
  });
});

test("server の契約の decode に落ちた 400 (body 無し) は invalid_argument", () => {
  expect(mfaErrorCodeOfCause(Cause.die(statusError(400)))).toBe("invalid_argument");
});

describe("mfaChallengeObservationOf", () => {
  test("pending: true は present", () => {
    expect(mfaChallengeObservationOf(Exit.succeed({ pending: true }))).toEqual({ kind: "present" });
  });

  test("pending: false は absent", () => {
    expect(mfaChallengeObservationOf(Exit.succeed({ pending: false }))).toEqual({ kind: "absent" });
  });

  test("取得の失敗は absent と推測せず unavailable", () => {
    expect(mfaChallengeObservationOf(Exit.die(new Error("network")))).toEqual({
      kind: "unavailable",
    });
  });
});
